using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Microsoft.Win32.SafeHandles;

// A private pipe carries only a lock path, owner PID and sequenced lease commands.
// No protected state, key, provider traffic or shell evaluation enters this mode.
internal static class StateLeaseWorker
{
    internal sealed record Request(string Path, int ParentPid, bool Trace);
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static InvalidOperationException Invalid() => new("Invalid private lease protocol.");

    internal static string? ReadLine(TextReader input, int maximum, bool tabs = false)
    {
        var text = new StringBuilder();
        while (true)
        {
            int c = input.Read();
            if (c < 0) { if (text.Length != 0) throw Invalid(); return null; }
            if (c == 10) return text.ToString();
            if ((c < 32 && !(tabs && c == 9)) || c > 126 || text.Length >= maximum) throw Invalid();
            text.Append((char)c);
        }
    }

    internal static Request ParseRequest(string line)
    {
        if (line.Length > 22000 || line.Any(c => c > 126 || c < 32 && c != '\t')) throw Invalid();
        string[] parts = line.Split('\t');
        if (parts.Length != 5 || parts[0] != "SXSY-LOCK/1" || !Positive(parts[1], out int pid) ||
            parts[2] is not ("0" or "1") || parts[3] != "0") throw Invalid();
        byte[] bytes = Convert.FromBase64String(parts[4]);
        if (bytes.Length is < 1 or > 16384 || Convert.ToBase64String(bytes) != parts[4]) throw Invalid();
        string path = Utf8.GetString(bytes);
        // Local drive paths only; no device namespace, named pipe, UNC or drive-relative path.
        if (path.Length < 4 || !char.IsAsciiLetter(path[0]) || path[1] != ':' || path[2] != '\\' ||
            path.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0 || path[3..].Contains(':')) throw Invalid();
        return new(path, pid, parts[2] == "1");
    }

    private static bool Positive(string text, out int number) =>
        int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out number) && number > 0 &&
        text == number.ToString(CultureInfo.InvariantCulture);

    internal static (int Sequence, bool NonBlocking) ParseAcquire(string line, int previous)
    {
        string[] parts = line.Split(' ');
        if (parts.Length != 3 || parts[0] != "ACQUIRE" || !Positive(parts[1], out int next) ||
            previous == int.MaxValue || next != previous + 1 || parts[2] is not ("0" or "1")) throw Invalid();
        return (next, parts[2] == "1");
    }

    private sealed class ParentWatcher(Action current) : IDisposable
    {
        private readonly Timer timer = new(_ => { try { current(); } catch { Environment.Exit(2); } }, null, 250, 250);
        // Join any in-flight observation before the pinned Process handle is disposed.
        public void Dispose() => timer.DisposeAsync().AsTask().GetAwaiter().GetResult();
    }

    [SupportedOSPlatform("windows")]
    internal static int Run()
    {
        using var input = new StreamReader(Console.OpenStandardInput(), Utf8);
        using var output = new StreamWriter(Console.OpenStandardOutput(), Utf8) { AutoFlush = true };
        using var trace = new StreamWriter(Console.OpenStandardError(), Utf8) { AutoFlush = true };
        try
        {
            trace.WriteLine("lease-entered");
            var request = ParseRequest(ReadLine(input, 22000, tabs: true) ?? throw Invalid());
            trace.WriteLine("lease-input-read");
            if (!string.Equals(System.IO.Path.GetFullPath(request.Path), request.Path, StringComparison.OrdinalIgnoreCase)) throw Invalid();
            if (request.Trace) trace.WriteLine("lease-request-read");
            using var parent = Process.GetProcessById(request.ParentPid);
            _ = parent.SafeHandle; // Keep the original kernel process handle, not a reusable PID lookup.
            var birth = parent.StartTime;
            void Current() { if (parent.HasExited || parent.StartTime != birth) throw Invalid(); }
            Current();
            using var watcher = new ParentWatcher(Current);
            if (request.Trace) trace.WriteLine("lease-owner-found");
            Identity expected;
            using (var observed = Open(request.Path, 0, 7)) expected = Inspect(observed);
            int sequence = 0;
            output.WriteLine("READY");
            string? command;
            while ((command = ReadLine(input, 64)) != null)
            {
                Current(); var acquire = ParseAcquire(command, sequence); sequence = acquire.Sequence;
                var deadline = Stopwatch.StartNew(); SafeFileHandle? held = null;
                try
                {
                    while (held == null)
                    {
                        Current();
                        try { held = Open(request.Path, 0xC0000000, 0); }
                        catch (Win32Exception error) when (error.NativeErrorCode is 32 or 33)
                        {
                            if (acquire.NonBlocking) break;
                            if (deadline.ElapsedMilliseconds >= 10000) throw Invalid();
                            Thread.Sleep(25);
                        }
                    }
                    if (held == null) { output.WriteLine($"BUSY {sequence}"); continue; }
                    if (Inspect(held) != expected) throw Invalid();
                    output.WriteLine($"LOCKED {sequence}");
                    string? release = ReadLine(input, 64);
                    if (release == null) break;
                    if (release != $"RELEASE {sequence}") throw Invalid();
                    Current();
                }
                finally { held?.Dispose(); }
                output.WriteLine($"RELEASED {sequence}");
            }
            return 0;
        }
        catch { return 2; } // No exception text, path, account or caller data leaves stderr.
    }

    private sealed record Identity(uint Volume, uint IndexHigh, uint IndexLow, int BirthHigh, int BirthLow);
    [SupportedOSPlatform("windows")]
    private static SafeFileHandle Open(string path, uint access, uint sharing)
    {
        var handle = CreateFileW(path, access, sharing, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
        if (!handle.IsInvalid) return handle;
        int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error);
    }
    [SupportedOSPlatform("windows")]
    private static Identity Inspect(SafeFileHandle handle)
    {
        if (!GetFileInformationByHandle(handle, out var information)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (GetFileType(handle) != 1 || (information.Attributes & 0x410) != 0 || information.Links != 1) throw Invalid();
        return new(information.Volume, information.IndexHigh, information.IndexLow, information.Creation.dwHighDateTime, information.Creation.dwLowDateTime);
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetFileType(SafeFileHandle handle);
}
