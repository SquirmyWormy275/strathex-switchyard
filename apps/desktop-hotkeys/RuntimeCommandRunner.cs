using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// Private stdio installer protocol, separate from all keyboard/window APIs.
// Creation-time Job Object assignment prevents even a suspended orphan escaping
// when the owner or this guardian disappears during CreateProcess.
internal static class RuntimeCommandRunner
{
    private const string Schema = "switchyard-runtime-command/v1";
    private static readonly object Lifecycle = new();
    private static bool ParentGone;
    private static Exception NativeError() => new InvalidOperationException("The native runtime boundary is unavailable.");
    private static async Task<string?> ReadLineBounded(TextReader reader)
    {
        var value = new StringBuilder(); var buffer = new char[1];
        while (await reader.ReadAsync(buffer.AsMemory()) != 0)
        {
            if (buffer[0] == '\n') return value.ToString();
            if (buffer[0] == '\r' || value.Length >= 65536) throw NativeError();
            value.Append(buffer[0]);
        }
        return value.Length == 0 ? null : throw NativeError();
    }
    private static void Write(object frame) { Console.WriteLine(JsonSerializer.Serialize(frame)); Console.Out.Flush(); }
    public static int Run()
    {
        if (!OperatingSystem.IsWindows()) return 2;
        try { return RunAsync().GetAwaiter().GetResult(); }
        catch { return 2; } // Paths, credentials and signed installer URLs are never logged.
    }
    public static int ReadStatus()
    {
        if (!OperatingSystem.IsWindows()) return 2;
        try
        {
            using var request = JsonDocument.Parse(ReadLineBounded(Console.In).GetAwaiter().GetResult() ?? throw NativeError());
            string id = request.RootElement.GetProperty("id").GetString() ?? "";
            if (request.RootElement.GetProperty("schema").GetString() != Schema || !Guid.TryParseExact(id, "D", out _)) throw NativeError();
            using SafeJobHandle job = OpenJobObjectW(4, false, JobName(id));
            if (job.IsInvalid && Marshal.GetLastWin32Error() != 2) throw NativeError();
            Write(new { schema = Schema, id, activeProcesses = job.IsInvalid ? 0 : ActiveProcesses(job), containment = "windows-job" });
            return 0;
        }
        catch { return 2; }
    }
    private static string JobName(string id) => "Local\\Switchyard.Runtime." + id;
    private static async Task<int> RunAsync()
    {
        using var document = JsonDocument.Parse(await ReadLineBounded(Console.In) ?? throw NativeError());
        var request = document.RootElement;
        string id = request.GetProperty("id").GetString() ?? "";
        string executable = request.GetProperty("executable").GetString() ?? "";
        string cwd = request.GetProperty("cwd").GetString() ?? "";
        string digest = request.GetProperty("executableSha256").GetString() ?? "";
        int timeout = request.GetProperty("timeoutMs").GetInt32(), limit = request.GetProperty("maxOutputBytes").GetInt32();
        if (request.GetProperty("schema").GetString() != Schema || !Guid.TryParseExact(id, "D", out _) || !Path.IsPathFullyQualified(executable) || !Path.IsPathFullyQualified(cwd) || executable.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0 || cwd.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0 || !Regex.IsMatch(digest, "^[a-f0-9]{64}$") || timeout < 1 || timeout > 600000 || limit < 1 || limit > 524288) throw NativeError();
        var args = request.GetProperty("args");
        if (args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 32) throw NativeError();
        string[] arguments = args.EnumerateArray().Select(a => a.GetString() ?? throw NativeError()).ToArray();
        if (arguments.Any(a => a.Length > 8192 || a.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)) throw NativeError();
        var env = request.GetProperty("environment");
        if (env.ValueKind != JsonValueKind.Object || env.EnumerateObject().Count() > 64) throw NativeError();
        var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in env.EnumerateObject())
        {
            string value = entry.Value.GetString() ?? throw NativeError();
            // These two standard Windows coordinates are present in the explicit
            // desktop allowlist; parentheses are not valid POSIX identifiers.
            if (!Regex.IsMatch(entry.Name, "^(?:[A-Za-z_][A-Za-z0-9_]*|ProgramFiles\\(x86\\)|CommonProgramFiles\\(x86\\))$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) || value.Length > 8192 || value.Contains('\0') || !environment.TryAdd(entry.Name, value)) throw NativeError();
        }
        if ((File.GetAttributes(executable) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw NativeError();
        using var executableLock = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (Convert.ToHexString(SHA256.HashData(executableLock)).ToLowerInvariant() != digest) throw NativeError();
        using var job = CreateJob(id);
        Write(new { schema = Schema, id, @event = "ready", guardianPid = Environment.ProcessId, birth = Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString(), containment = "windows-job" });
        using var ack = JsonDocument.Parse(await ReadLineBounded(Console.In) ?? throw NativeError());
        if (ack.RootElement.GetProperty("schema").GetString() != Schema || ack.RootElement.GetProperty("id").GetString() != id || !ack.RootElement.GetProperty("start").GetBoolean()) throw NativeError();
        _ = Task.Run(async () =>
        {
            try { await Console.In.ReadAsync(new char[1].AsMemory()); }
            finally { lock (Lifecycle) { ParentGone = true; if (!job.IsClosed) _ = TerminateJobObject(job, 130); } }
        });
        Started child;
        lock (Lifecycle)
        {
            if (ParentGone) throw NativeError();
            child = Start(executable, arguments, cwd, environment, job);
            if (ResumeThread(child.Thread) == uint.MaxValue) { child.Dispose(); throw NativeError(); }
        }
        using (child)
        {
            string status = "completed";
            void Stop(string reason) { lock (Lifecycle) { if (status == "completed") status = reason; _ = TerminateJobObject(job, 124); } }
            using var timer = new Timer(_ => Stop("timed-out"), null, timeout, Timeout.Infinite);
            Task<byte[]> output = Drain(child.Output, limit, () => Stop("output-limit"));
            Task<byte[]> errors = Drain(child.Error, 0, null);
            uint exitCode = await Task.Run(() =>
            {
                if (WaitForSingleObject(child.Process, uint.MaxValue) != 0 || !GetExitCodeProcess(child.Process, out uint code)) throw NativeError();
                return code;
            });
            timer.Change(Timeout.Infinite, Timeout.Infinite);
            if (!TerminateJobObject(job, 0)) throw NativeError();
            var watch = Stopwatch.StartNew();
            while (ActiveProcesses(job) != 0 && watch.ElapsedMilliseconds < 3000) await Task.Delay(10);
            if (ActiveProcesses(job) != 0) throw NativeError();
            await Task.WhenAll(output, errors).WaitAsync(TimeSpan.FromSeconds(3));
            lock (Lifecycle) { if (ParentGone) throw NativeError(); if (status == "completed" && exitCode != 0) status = "failed"; }
            Write(new { schema = Schema, id, @event = "result", status, exitCode, stdout = Convert.ToBase64String(await output), treeExitVerified = true, containment = "windows-job" });
            return 0;
        }
    }
    private static async Task<byte[]> Drain(Stream stream, int limit, Action? overflow)
    {
        using var captured = new MemoryStream(); var buffer = new byte[4096]; bool exceeded = false;
        int read;
        while ((read = await stream.ReadAsync(buffer.AsMemory())) != 0)
        {
            int keep = Math.Min(read, limit - checked((int)captured.Length));
            if (keep > 0) captured.Write(buffer, 0, keep);
            if (overflow != null && keep < read && !exceeded) { exceeded = true; overflow(); }
        }
        return captured.ToArray();
    }
    private static string Quote(string value)
    {
        var quoted = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) { if (c == '\\') { slashes++; continue; } quoted.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); quoted.Append(c); slashes = 0; }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }
    private static Started Start(string executable, string[] args, string cwd, SortedDictionary<string, string> environment, SafeJobHandle job)
    {
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, jobs = IntPtr.Zero, env = IntPtr.Zero;
        bool initialized = false, transferred = false;
        try
        {
            var security = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Inherit = true };
            if (!CreatePipe(out outputRead, out outputWrite, ref security, 0) || !CreatePipe(out errorRead, out errorWrite, ref security, 0) || !SetHandleInformation(outputRead, 1, 0) || !SetHandleInformation(errorRead, 1, 0)) throw NativeError();
            using SafeFileHandle input = CreateFileW("NUL", 0x80000000, 3, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
            if (input.IsInvalid || !SetHandleInformation(input.DangerousGetHandle(), 1, 1)) throw NativeError();
            var size = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributes, 2, 0, ref size)) throw NativeError();
            initialized = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3); jobs = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(handles, 0, input.DangerousGetHandle()); Marshal.WriteIntPtr(handles, IntPtr.Size, outputWrite); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errorWrite); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero) || !UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw NativeError();
            var startup = new StartupInfoEx { Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Flags = 0x100, Input = input.DangerousGetHandle(), Output = outputWrite, Error = errorWrite }, Attributes = attributes };
            env = Marshal.StringToHGlobalUni(string.Join('\0', environment.Select(e => e.Key + "=" + e.Value)) + "\0\0");
            if (!CreateProcessW(executable, new StringBuilder(string.Join(' ', new[] { executable }.Concat(args).Select(Quote))), IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x8000000 | 0x400 | 0x80000, env, cwd, ref startup, out var process)) throw NativeError();
            transferred = true;
            return new Started(new SafeFileHandle(process.Process, true), new SafeFileHandle(process.Thread, true), new FileStream(new SafeFileHandle(outputRead, true), FileAccess.Read, 4096, false), new FileStream(new SafeFileHandle(errorRead, true), FileAccess.Read, 4096, false));
        }
        finally
        {
            if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite); if (errorWrite != IntPtr.Zero) CloseHandle(errorWrite);
            if (!transferred) { if (outputRead != IntPtr.Zero) CloseHandle(outputRead); if (errorRead != IntPtr.Zero) CloseHandle(errorRead); }
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles); if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs); if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
        }
    }
    private static SafeJobHandle CreateJob(string id)
    {
        SafeJobHandle job = CreateJobObjectW(IntPtr.Zero, JobName(id));
        if (job.IsInvalid || Marshal.GetLastWin32Error() == 183) { job.Dispose(); throw NativeError(); }
        var information = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
        IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf<ExtendedLimits>());
        try { Marshal.StructureToPtr(information, pointer, false); if (!SetInformationJobObject(job, 9, pointer, (uint)Marshal.SizeOf<ExtendedLimits>())) { job.Dispose(); throw NativeError(); } }
        finally { Marshal.FreeHGlobal(pointer); }
        return job;
    }
    private static uint ActiveProcesses(SafeJobHandle job)
    {
        IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf<Accounting>());
        try { if (!QueryInformationJobObject(job, 1, pointer, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero)) throw NativeError(); return Marshal.PtrToStructure<Accounting>(pointer).Active; }
        finally { Marshal.FreeHGlobal(pointer); }
    }
    private sealed record Started(SafeFileHandle Process, SafeFileHandle Thread, FileStream Output, FileStream Error) : IDisposable { public void Dispose() { Output.Dispose(); Error.Dispose(); Thread.Dispose(); Process.Dispose(); } }
    private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid { private SafeJobHandle() : base(true) {} protected override bool ReleaseHandle() => CloseHandle(handle); }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo { public int Size; public string? Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags; public ushort Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo Info; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum; public uint Count; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadCount, WriteCount, OtherCount, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting { public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; public uint Faults, Total, Active, Terminated; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeJobHandle CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeJobHandle OpenJobObjectW(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(SafeJobHandle job, int kind, IntPtr information, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(SafeJobHandle job, int kind, IntPtr information, uint size, IntPtr returnedSize);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(SafeJobHandle job, uint code);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle process, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
}
