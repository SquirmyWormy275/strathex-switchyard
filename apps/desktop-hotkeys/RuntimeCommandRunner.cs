using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// Private stdio native-command protocol, separate from keyboard/window APIs.
// Creation-time Job Object assignment prevents even a suspended orphan escaping
// when the owner or this guardian disappears during CreateProcess.
internal static class RuntimeCommandRunner
{
    private const string Schema = "switchyard-runtime-command/v1";
    private static readonly object Lifecycle = new();
    private static bool ParentGone;
    private sealed class StartupObservation
    {
        public string? Id;
        public string Phase = "request-fields";
        public uint? NativeCode;
        public TokenQueryObservation? SelfTokenQuery;
        public bool Ready;
        public bool WorkerStarting;
        public void WorkerStage(string phase) { Phase = phase; NativeCode = null; }
        public object? Failure
        {
            get
            {
                if (Id is null) return null;
                if (!Ready) return new { schema = Schema, id = Id, @event = "startup-failure", containment = "windows-job", phase = Phase, nativeCode = NativeCode, selfTokenQuery = SelfTokenQuery };
                if (WorkerStarting) return new { schema = Schema, id = Id, @event = "worker-start-failure", containment = "windows-job", phase = Phase, nativeCode = NativeCode };
                return null;
            }
        }
    }
    private sealed record TokenQueryObservation(bool opened, uint error, uint? closeError, bool handlesClosedVerified);
    // After a Job-creation denial only: observe the failing process's existing
    // QUERY access. Never duplicate a token, change an ACL, or grant new rights.
    private static TokenQueryObservation ObserveSelfTokenQuery()
    {
        bool opened = OpenProcessToken(new IntPtr(-1), 8, out IntPtr token);
        uint error = opened ? 0u : unchecked((uint)Marshal.GetLastWin32Error());
        if (token == IntPtr.Zero) return new(false, error, null, !opened);
        bool closed = CloseObservedHandle(token);
        uint closeError = closed ? 0u : unchecked((uint)Marshal.GetLastWin32Error());
        return new(opened, error, opened ? closeError : null, closed);
    }
    private static Exception NativeError() => new InvalidOperationException("The native runtime boundary is unavailable.");
    private static void RequireWorkerApi(bool succeeded, StartupObservation observation)
    {
        if (succeeded) return;
        observation.NativeCode = unchecked((uint)Marshal.GetLastWin32Error());
        throw NativeError();
    }
    private static void CreateOwnedPipe(out IntPtr read, out IntPtr write, ref SecurityAttributes security, StartupObservation observation)
    {
        // Failed CreatePipe output handles are documented as indeterminate.
        // Publish handles to cleanup only after successful creation.
        read = write = IntPtr.Zero;
        bool created = CreatePipe(out IntPtr createdRead, out IntPtr createdWrite, ref security, 0);
        RequireWorkerApi(created, observation);
        read = createdRead; write = createdWrite;
    }
    private static async Task<string?> ReadLineBounded(TextReader reader)
    {
        var value = new StringBuilder(); var buffer = new char[1];
        while (await reader.ReadAsync(buffer.AsMemory()) != 0)
        {
            if (buffer[0] == '\n') return value.ToString();
            if (buffer[0] == '\r' || value.Length >= 1048576) throw NativeError();
            value.Append(buffer[0]);
        }
        return value.Length == 0 ? null : throw NativeError();
    }
    private static void Write(object frame) { Console.WriteLine(JsonSerializer.Serialize(frame)); Console.Out.Flush(); }
    public static int Run()
    {
        if (!OperatingSystem.IsWindows()) return 2;
        var startup = new StartupObservation();
        try { return RunAsync(startup).GetAwaiter().GetResult(); }
        catch
        {
            // Only fixed stages and an API-specific numeric failure are emitted.
            // This is a refusal, never readiness, execution or cleanup evidence.
            try { if (startup.Failure is object failure) Write(failure); } catch { }
            return 2; // Paths, credentials and signed installer URLs are never logged.
        }
    }
    public static int ReadStatus()
    {
        if (!OperatingSystem.IsWindows()) return 2;
        try
        {
            using var request = JsonDocument.Parse(ReadLineBounded(Console.In).GetAwaiter().GetResult() ?? throw NativeError());
            string id = request.RootElement.GetProperty("id").GetString() ?? "";
            int guardianPid=request.RootElement.GetProperty("guardianPid").GetInt32();string birth=request.RootElement.GetProperty("birth").GetString()??"";
            if (request.RootElement.GetProperty("schema").GetString() != Schema || !Guid.TryParseExact(id, "D", out _)||guardianPid<1||!long.TryParse(birth,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out long expectedBirth)||expectedBirth<1) throw NativeError();
            bool guardianExited;
            try{using var process=Process.GetProcessById(guardianPid);guardianExited=process.StartTime.ToUniversalTime().Ticks!=expectedBirth||process.HasExited;}
            catch(ArgumentException){guardianExited=true;}
            using SafeJobHandle job = OpenJobObjectW(4, false, JobName(id));
            if (job.IsInvalid && Marshal.GetLastWin32Error() != 2) throw NativeError();
            Write(new { schema = Schema, id, guardianPid,birth,guardianExited,activeProcesses = job.IsInvalid ? 0 : ActiveProcesses(job), containment = "windows-job" });
            return 0;
        }
        catch { return 2; }
    }
    private static string JobName(string id) => "Local\\Switchyard.Runtime." + id;
    private static async Task<int> RunAsync(StartupObservation startup)
    {
        using var document = JsonDocument.Parse(await ReadLineBounded(Console.In) ?? throw NativeError());
        var request = document.RootElement;
        string id = request.GetProperty("id").GetString() ?? "";
        if (request.GetProperty("schema").GetString() == Schema && Guid.TryParseExact(id, "D", out _)) startup.Id = id;
        string executable = request.GetProperty("executable").GetString() ?? "";
        string cwd = request.GetProperty("cwd").GetString() ?? "";
        string digest = request.GetProperty("executableSha256").GetString() ?? "";
        int timeout = request.GetProperty("timeoutMs").GetInt32(), limit = request.GetProperty("maxOutputBytes").GetInt32();
        if (request.GetProperty("schema").GetString() != Schema || !Guid.TryParseExact(id, "D", out _) || !Path.IsPathFullyQualified(executable) || !Path.IsPathFullyQualified(cwd) || executable.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0 || cwd.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0 || !Regex.IsMatch(digest, "^[a-f0-9]{64}$") || timeout < 1 || timeout > 600000 || limit < 1 || limit > 524288) throw NativeError();
        var args = request.GetProperty("args");
        if (args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 256) throw NativeError();
        string[] arguments = args.EnumerateArray().Select(a => a.GetString() ?? throw NativeError()).ToArray();
        if (arguments.Any(a => a.Length > 8192 || a.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)) throw NativeError();
        byte[] inputBytes = Array.Empty<byte>();
        if (request.TryGetProperty("inputBase64", out var inputValue))
        {
            string encoded = inputValue.GetString() ?? throw NativeError();
            inputBytes = Convert.FromBase64String(encoded);
            if (inputBytes.Length > 524288 || Convert.ToBase64String(inputBytes) != encoded) throw NativeError();
        }
        int stderrLimit = request.TryGetProperty("maxStderrBytes", out var stderrValue) ? stderrValue.GetInt32() : 0;
        if (stderrLimit < 0 || stderrLimit > 16384) throw NativeError();
        bool workerAcknowledgement = request.TryGetProperty("workerAcknowledgement", out var workerAckValue) && workerAckValue.GetBoolean();
        startup.Phase = "environment";
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
        startup.Phase = "executable-attributes";
        if ((File.GetAttributes(executable) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw NativeError();
        startup.Phase = "executable-open";
        using var executableLock = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        startup.Phase = "executable-hash";
        if (Convert.ToHexString(SHA256.HashData(executableLock)).ToLowerInvariant() != digest) throw NativeError();
        using var job = CreateJob(id, startup);
        startup.Phase = "self-birth";
        // The current-process pseudo handle identifies this exact guardian.
        // Reopening its PID through Process.StartTime can be denied under the
        // original restricted process DACL; no additional access is needed.
        if (!GetSelfProcessTimes(GetCurrentProcess(), out long selfCreated, out _, out _, out _)) throw NativeError();
        string birth = DateTime.FromFileTimeUtc(selfCreated).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startup.Phase = "ready-write";
        Write(new { schema = Schema, id, @event = "ready", guardianPid = Environment.ProcessId, birth, containment = "windows-job", capabilities = new[] { "bounded-stdin", "bounded-stdin-512k", "bounded-stderr", "suspended-worker-ack" } });
        startup.Ready = true;
        using var ack = JsonDocument.Parse(await ReadLineBounded(Console.In) ?? throw NativeError());
        if (ack.RootElement.GetProperty("schema").GetString() != Schema || ack.RootElement.GetProperty("id").GetString() != id || !ack.RootElement.GetProperty("start").GetBoolean()) throw NativeError();
        void WatchParent() => _ = Task.Run(async () =>
        {
            try { await Console.In.ReadAsync(new char[1].AsMemory()); }
            finally { lock (Lifecycle) { ParentGone = true; if (!job.IsClosed) _ = TerminateJobObject(job, 130); } }
        });
        // The optional handshake owns stdin until its one bounded response. A
        // second reader must never consume any part of that acknowledgement.
        if (!workerAcknowledgement) WatchParent();
        Started child;
        lock (Lifecycle)
        {
            if (ParentGone) throw NativeError();
            startup.WorkerStarting = true;
            child = Start(executable, arguments, cwd, environment, job, startup);
        }
        using (child)
        {
            if (workerAcknowledgement)
            {
                startup.WorkerStage("worker-id");
                uint workerPid = GetProcessId(child.Process);
                RequireWorkerApi(workerPid != 0, startup);
                startup.WorkerStage("worker-birth");
                RequireWorkerApi(GetProcessTimes(child.Process, out long created, out _, out _, out _), startup);
                string workerBirth = DateTime.FromFileTimeUtc(created).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
                startup.WorkerStarting = false;
                Write(new { schema = Schema, id, @event = "worker-suspended", containment = "windows-job", guardianPid = Environment.ProcessId, birth, workerPid, workerBirth, executableSha256 = digest });
                // Console.In can perform its read synchronously even through
                // ReadAsync; keep that read off the thread enforcing the bound.
                using var workerAck = JsonDocument.Parse(await Task.Run(() => ReadLineBounded(Console.In)).WaitAsync(TimeSpan.FromSeconds(10)) ?? throw NativeError());
                var value = workerAck.RootElement;
                string[] keys = { "schema", "id", "workerPid", "workerBirth", "executableSha256", "startWorker" };
                if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != keys.Length || keys.Any(key => !value.TryGetProperty(key, out _))
                    || value.GetProperty("schema").GetString() != Schema || value.GetProperty("id").GetString() != id
                    || value.GetProperty("workerPid").GetUInt32() != workerPid || value.GetProperty("workerBirth").GetString() != workerBirth
                    || value.GetProperty("executableSha256").GetString() != digest || !value.GetProperty("startWorker").GetBoolean()) throw NativeError();
                WatchParent();
            }
            startup.WorkerStarting = false;
            lock (Lifecycle)
            {
                if (ParentGone || ResumeThread(child.Thread) != 1) throw NativeError();
            }
            string status = "completed";
            void Stop(string reason) { lock (Lifecycle) { if (status == "completed") status = reason; _ = TerminateJobObject(job, 124); } }
            using var timer = new Timer(_ => Stop("timed-out"), null, timeout, Timeout.Infinite);
            Task<byte[]> output = Drain(child.Output, limit, () => Stop("output-limit"));
            Task<byte[]> errors = Drain(child.Error, stderrLimit, stderrLimit > 0 ? () => Stop("output-limit") : null);
            Task<bool> supplied = SupplyInput(child.Input, inputBytes);
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
            Write(new { schema = Schema, id, @event = "result", status, exitCode, stdout = Convert.ToBase64String(await output), stderr = Convert.ToBase64String(await errors), inputDelivered = await supplied, treeExitVerified = true, containment = "windows-job" });
            return 0;
        }
    }
    private static async Task<bool> SupplyInput(Stream input, byte[] bytes)
    {
        try { await input.WriteAsync(bytes.AsMemory()); return true; }
        catch (IOException) { return false; }
        finally { input.Dispose(); }
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
    private static Started Start(string executable, string[] args, string cwd, SortedDictionary<string, string> environment, SafeJobHandle job, StartupObservation observation)
    {
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, jobs = IntPtr.Zero, env = IntPtr.Zero;
        bool initialized = false, transferred = false;
        try
        {
            observation.WorkerStage("pipe-security");
            using var pipeSecurity = new RuntimePrivatePipeSecurity();
            var security = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = pipeSecurity.Descriptor, Inherit = true };
            observation.WorkerStage("stdin-pipe"); CreateOwnedPipe(out inputRead, out inputWrite, ref security, observation);
            observation.WorkerStage("stdout-pipe"); CreateOwnedPipe(out outputRead, out outputWrite, ref security, observation);
            observation.WorkerStage("stderr-pipe"); CreateOwnedPipe(out errorRead, out errorWrite, ref security, observation);
            observation.WorkerStage("pipe-security-verify");
            foreach (IntPtr pipe in new[] { inputRead, inputWrite, outputRead, outputWrite, errorRead, errorWrite }) pipeSecurity.Verify(pipe);
            pipeSecurity.VerifyDefaultDaclUnchanged();
            observation.WorkerStage("stdin-inheritance"); RequireWorkerApi(SetHandleInformation(inputWrite, 1, 0), observation);
            observation.WorkerStage("stdout-inheritance"); RequireWorkerApi(SetHandleInformation(outputRead, 1, 0), observation);
            observation.WorkerStage("stderr-inheritance"); RequireWorkerApi(SetHandleInformation(errorRead, 1, 0), observation);
            observation.WorkerStage("attribute-size");
            var size = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            RequireWorkerApi(size != IntPtr.Zero, observation);
            observation.WorkerStage("attribute-allocation");
            attributes = Marshal.AllocHGlobal(size);
            observation.WorkerStage("attribute-initialize"); RequireWorkerApi(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), observation);
            initialized = true;
            observation.WorkerStage("handle-storage");
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3); jobs = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(handles, 0, inputRead); Marshal.WriteIntPtr(handles, IntPtr.Size, outputWrite); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errorWrite); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
            observation.WorkerStage("handles-attribute"); RequireWorkerApi(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero), observation);
            observation.WorkerStage("job-attribute"); RequireWorkerApi(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), observation);
            var startup = new StartupInfoEx { Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Flags = 0x100, Input = inputRead, Output = outputWrite, Error = errorWrite }, Attributes = attributes };
            observation.WorkerStage("environment-block");
            env = Marshal.StringToHGlobalUni(string.Join('\0', environment.Select(e => e.Key + "=" + e.Value)) + "\0\0");
            observation.WorkerStage("process-create");
            RequireWorkerApi(CreateProcessW(executable, new StringBuilder(string.Join(' ', new[] { executable }.Concat(args).Select(Quote))), IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x8000000 | 0x400 | 0x80000, env, cwd, ref startup, out var process), observation);
            observation.WorkerStage("worker-streams");
            transferred = true;
            return new Started(new SafeFileHandle(process.Process, true), new SafeFileHandle(process.Thread, true), new FileStream(new SafeFileHandle(inputWrite, true), FileAccess.Write, 4096, false), new FileStream(new SafeFileHandle(outputRead, true), FileAccess.Read, 4096, false), new FileStream(new SafeFileHandle(errorRead, true), FileAccess.Read, 4096, false));
        }
        finally
        {
            if (inputRead != IntPtr.Zero) CloseHandle(inputRead); if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite); if (errorWrite != IntPtr.Zero) CloseHandle(errorWrite);
            if (!transferred) { if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite); if (outputRead != IntPtr.Zero) CloseHandle(outputRead); if (errorRead != IntPtr.Zero) CloseHandle(errorRead); }
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles); if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs); if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
        }
    }
    private static SafeJobHandle CreateJob(string id, StartupObservation startup)
    {
        startup.Phase = "job-create";
        SafeJobHandle job = CreateJobObjectW(IntPtr.Zero, JobName(id));
        int createError = Marshal.GetLastWin32Error();
        if (job.IsInvalid || createError == 183)
        {
            startup.NativeCode = unchecked((uint)createError);
            bool denied = job.IsInvalid && createError == 5;
            job.Dispose();
            if (denied) startup.SelfTokenQuery = ObserveSelfTokenQuery();
            throw NativeError();
        }
        startup.Phase = "job-configure";
        var information = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
        IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf<ExtendedLimits>());
        try { Marshal.StructureToPtr(information, pointer, false); if (!SetInformationJobObject(job, 9, pointer, (uint)Marshal.SizeOf<ExtendedLimits>())) { startup.NativeCode = unchecked((uint)Marshal.GetLastWin32Error()); job.Dispose(); throw NativeError(); } }
        finally { Marshal.FreeHGlobal(pointer); }
        return job;
    }
    private static uint ActiveProcesses(SafeJobHandle job)
    {
        IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf<Accounting>());
        try { if (!QueryInformationJobObject(job, 1, pointer, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero)) throw NativeError(); return Marshal.PtrToStructure<Accounting>(pointer).Active; }
        finally { Marshal.FreeHGlobal(pointer); }
    }
    private sealed record Started(SafeFileHandle Process, SafeFileHandle Thread, FileStream Input, FileStream Output, FileStream Error) : IDisposable { public void Dispose() { Input.Dispose(); Output.Dispose(); Error.Dispose(); Thread.Dispose(); Process.Dispose(); } }
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
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(SafeFileHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(SafeFileHandle process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", EntryPoint = "GetProcessTimes", SetLastError = true)] private static extern bool GetSelfProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle process, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", EntryPoint = "CloseHandle", SetLastError = true)] private static extern bool CloseObservedHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
}
