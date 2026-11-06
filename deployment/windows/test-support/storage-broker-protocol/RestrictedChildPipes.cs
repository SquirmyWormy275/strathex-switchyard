using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

internal static class RestrictedChildStderr
{
    internal sealed record Summary(string category, string? function, string? code, string? sourceFile = null, int? sourceLine = null);
    internal static Summary Parse(byte[] prefix)
    {
        if (prefix.Length > 8192) throw new InvalidOperationException("Child diagnostic prefix exceeds its bound.");
        string text = Encoding.UTF8.GetString(prefix);
        string category = prefix.Length == 0 ? "empty" : text.Contains("Assertion failed", StringComparison.OrdinalIgnoreCase) ? "assertion" : text.Contains("node::", StringComparison.Ordinal) ? "node-native" : text.Contains("Error:", StringComparison.Ordinal) ? "javascript" : "unclassified";
        string[] functions = { "uv_thread_create", "uv_os_get_passwd", "uv_loop_init", "uv_tty_init", "uv_pipe_init", "uv_pipe_open", "uv_guess_handle", "uv_disable_stdio_inheritance", "uv_signal_init", "uv_mutex_init", "ncrypto::CSPRNG" };
        string[] codes = { "UV_UNKNOWN", "EACCES", "EPERM", "EBADF", "EINVAL", "ENOENT", "ENOMEM" };
        // Node's assertion header includes its compiler source location. Retain
        // only known upstream basenames and a bounded line number, never paths,
        // function signatures, assertion expressions or stack addresses.
        var location = category == "assertion" ? Regex.Match(text, @" at (?:[^\r\n]{0,1024}[\\/])?src[\\/](?:crypto[\\/])?(?<file>node\.cc|node_main\.cc|node_platform\.cc|node_errors\.cc|node_api\.cc|node_file\.cc|node_process_methods\.cc|node_process_object\.cc|env\.cc|env-inl\.h|util\.cc|util\.h|util-inl\.h|crypto_util\.cc):(?<line>[1-9][0-9]{0,4})(?:\r?\n|$)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)) : Match.Empty;
        return new(category, functions.FirstOrDefault(value => text.Contains(value, StringComparison.Ordinal)), codes.FirstOrDefault(value => text.Contains(value, StringComparison.Ordinal)), location.Success ? location.Groups["file"].Value : null, location.Success ? int.Parse(location.Groups["line"].Value, System.Globalization.CultureInfo.InvariantCulture) : null);
    }
}

// Test assembly only. No terminal/console attachment or inherited service handle.
[SupportedOSPlatform("windows")]
internal sealed class RestrictedChildPipes : IDisposable
{
    private readonly AnonymousPipeServerStream input, output, error;
    private readonly SafePipeHandle[] servers, clients;
    private readonly Task<Drain> outputDrain, errorDrain;
    private IntPtr handleList;
    private bool childCopiesClosed, completed;
    private Evidence? evidence;
    internal sealed record Evidence(string schema, int standardHandles, bool inheritanceRestricted, bool stdinEof, long stdoutBytes, long stderrBytes, bool outputBounded, bool handlesClosedVerified, bool drainsCompleted, RestrictedChildStderr.Summary stderr);
    private sealed record Drain(long Bytes, byte[] Prefix);
    private static void Native(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    internal RestrictedChildPipes()
    {
        AnonymousPipeServerStream? first = null, second = null, third = null;
        try
        {
            first = new(PipeDirection.Out, HandleInheritability.Inheritable);
            second = new(PipeDirection.In, HandleInheritability.Inheritable);
            third = new(PipeDirection.In, HandleInheritability.Inheritable);
            input = first; output = second; error = third;
            servers = new[] { input.SafePipeHandle, output.SafePipeHandle, error.SafePipeHandle };
            clients = new[] { input.ClientSafePipeHandle, output.ClientSafePipeHandle, error.ClientSafePipeHandle };
            foreach (var handle in clients) { Native(GetHandleInformation(handle, out uint flags)); if ((flags & 1) == 0) throw new InvalidOperationException("A standard child handle is not inheritable."); }
            foreach (var handle in servers) { Native(GetHandleInformation(handle, out uint flags)); if ((flags & 1) != 0) throw new InvalidOperationException("A parent pipe endpoint is inheritable."); }
            handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
            for (int i = 0; i < 3; i++) Marshal.WriteIntPtr(handleList, i * IntPtr.Size, clients[i].DangerousGetHandle());
            outputDrain = Task.Run(() => Read(output, 0)); errorDrain = Task.Run(() => Read(error, 8192));
        }
        catch
        {
            first?.Dispose(); second?.Dispose(); third?.Dispose();
            if (handleList != IntPtr.Zero) { Marshal.FreeHGlobal(handleList); handleList = IntPtr.Zero; }
            throw;
        }
    }

    internal IntPtr Input => clients[0].DangerousGetHandle();
    internal IntPtr Output => clients[1].DangerousGetHandle();
    internal IntPtr Error => clients[2].DangerousGetHandle();
    internal void Bind(IntPtr attributes) => Native(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handleList, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));

    internal void ChildStarted()
    {
        if (childCopiesClosed) return;
        input.DisposeLocalCopyOfClientHandle(); output.DisposeLocalCopyOfClientHandle(); error.DisposeLocalCopyOfClientHandle();
        input.Dispose(); // The fixed file-based proof receives EOF, never parent console input.
        childCopiesClosed = true;
    }

    private static Drain Read(Stream stream, int prefixLimit)
    {
        var buffer = new byte[4096]; using var prefix = new MemoryStream(); long count = 0; int read;
        while ((read = stream.Read(buffer, 0, buffer.Length)) != 0)
        {
            count = checked(count + read); int keep = Math.Min(read, prefixLimit - checked((int)prefix.Length));
            if (keep > 0) prefix.Write(buffer, 0, keep);
        }
        return new(count, prefix.ToArray());
    }

    internal Evidence Complete()
    {
        if (completed) return evidence ?? throw new InvalidOperationException("Child pipe retirement is unconfirmed.");
        try
        {
            ChildStarted();
            if (!Task.WaitAll(new Task[] { outputDrain, errorDrain }, 3000)) throw new InvalidOperationException("Child pipe drains did not finish after its owned Job exited.");
            var stdout = outputDrain.Result; var stderr = errorDrain.Result;
            output.Dispose(); error.Dispose();
            if (servers.Concat(clients).Any(handle => !handle.IsClosed)) throw new InvalidOperationException("An original standard pipe handle remains open.");
            evidence = new("switchyard-restricted-child-stdio/v1", 3, true, true, stdout.Bytes, stderr.Bytes, stdout.Bytes <= 65536 && stderr.Bytes <= 8192, true, true, RestrictedChildStderr.Parse(stderr.Prefix));
            Array.Clear(stderr.Prefix); return evidence;
        }
        finally { completed = true; input.Dispose(); output.Dispose(); error.Dispose(); }
    }

    public void Dispose()
    {
        try { if (!completed) Complete(); }
        finally { if (handleList != IntPtr.Zero) { Marshal.FreeHGlobal(handleList); handleList = IntPtr.Zero; } }
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetHandleInformation(SafePipeHandle handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
}
