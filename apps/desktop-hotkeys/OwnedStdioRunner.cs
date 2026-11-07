using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;

// Persistent private byte transport using the existing creation-time Job and
// anonymous-pipe policy. This role has no command timeout: parent loss, protocol
// failure or explicit stop retires its original Job. Every chunk is acknowledged
// before the next one; no provider/task/account authority is defined here.
internal static partial class RuntimeCommandRunner
{
    private const string StdioRole = "owned-stdio";
    private const int StdioChunk = 16384;
    private static readonly object StdioWriteLock = new();
    private static void StdioWrite(object value) { lock (StdioWriteLock) Write(value); }
    private static void StdioFields(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw NativeError();
        var fields = value.EnumerateObject().ToArray();
        if (fields.Length != names.Length || fields.Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != names.Length || names.Any(n => !value.TryGetProperty(n, out _))) throw NativeError();
    }
    private static void StdioEnvelope(JsonElement value, string id)
    {
        if (value.GetProperty("schema").GetString() != Schema || value.GetProperty("id").GetString() != id || value.GetProperty("role").GetString() != StdioRole) throw NativeError();
    }
    public static int RunOwnedStdio()
    {
        if (!OperatingSystem.IsWindows()) return 2;
        var startup = new StartupObservation();
        try { return RunOwnedStdioAsync(startup).GetAwaiter().GetResult(); }
        catch { try { if (startup.Failure is object failure) StdioWrite(failure); } catch { } return 2; }
    }
    private static async Task<int> RunOwnedStdioAsync(StartupObservation startup)
    {
        using var request = JsonDocument.Parse(await ReadLineBounded(Console.In) ?? throw NativeError());
        var v = request.RootElement;
        StdioFields(v, "schema", "id", "role", "executable", "executableSha256", "args", "cwd", "environment");
        string id = v.GetProperty("id").GetString() ?? ""; StdioEnvelope(v, id);
        if (!Guid.TryParseExact(id, "D", out Guid parsed) || parsed == Guid.Empty || parsed.ToString("D") != id) throw NativeError();
        startup.Id = id;
        string executable = v.GetProperty("executable").GetString() ?? "", cwd = v.GetProperty("cwd").GetString() ?? "", digest = v.GetProperty("executableSha256").GetString() ?? "";
        bool LocalPath(string path) => path.Length is > 3 and <= 4096 && Regex.IsMatch(path, "^[A-Za-z]:\\\\") && Path.IsPathFullyQualified(path)
            && Path.GetFullPath(path) == path && path.IndexOfAny(new[] { '\0', '\r', '\n' }) < 0;
        if (!LocalPath(executable) || !LocalPath(cwd) || !Regex.IsMatch(digest, "^[a-f0-9]{64}$")) throw NativeError();
        var args = v.GetProperty("args");
        if (args.ValueKind != JsonValueKind.Array || args.GetArrayLength() > 256) throw NativeError();
        string[] arguments = args.EnumerateArray().Select(a => a.GetString() ?? throw NativeError()).ToArray();
        if (arguments.Any(a => a.Length > 8192 || a.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)) throw NativeError();
        startup.Phase = "environment";
        var env = v.GetProperty("environment"); if (env.ValueKind != JsonValueKind.Object || env.EnumerateObject().Count() > 64) throw NativeError();
        var environment = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in env.EnumerateObject())
        {
            string value = entry.Value.GetString() ?? throw NativeError();
            if (!Regex.IsMatch(entry.Name, "^(?:[A-Za-z_][A-Za-z0-9_]*|ProgramFiles\\(x86\\)|CommonProgramFiles\\(x86\\))$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                || value.Length > 8192 || value.Contains('\0') || !environment.TryAdd(entry.Name, value)) throw NativeError();
        }
        startup.Phase = "executable-attributes";
        if ((File.GetAttributes(executable) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0 || (File.GetAttributes(cwd) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != FileAttributes.Directory) throw NativeError();
        startup.Phase = "executable-open";
        using var image = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        startup.Phase = "executable-hash";
        if (Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant() != digest) throw NativeError();
        using var job = CreateJob(id, startup);
        startup.Phase = "self-birth";
        if (!GetSelfProcessTimes(GetCurrentProcess(), out long created, out _, out _, out _)) throw NativeError();
        string birth = DateTime.FromFileTimeUtc(created).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startup.Phase = "ready-write";
        StdioWrite(new { schema = Schema, id, role = StdioRole, @event = "ready", guardianPid = Environment.ProcessId, birth, containment = "windows-job" }); startup.Ready = true;
        using (var ack = JsonDocument.Parse(await Task.Run(() => ReadLineBounded(Console.In)).WaitAsync(TimeSpan.FromSeconds(10)) ?? throw NativeError()))
        {
            StdioFields(ack.RootElement, "schema", "id", "role", "start"); StdioEnvelope(ack.RootElement, id);
            if (!ack.RootElement.GetProperty("start").GetBoolean()) throw NativeError();
        }
        startup.WorkerStarting = true;
        using var child = Start(executable, arguments, cwd, environment, job, startup);
        startup.WorkerStage("worker-id"); uint workerPid = GetProcessId(child.Process); RequireWorkerApi(workerPid != 0, startup);
        startup.WorkerStage("worker-birth"); RequireWorkerApi(GetProcessTimes(child.Process, out long workerCreated, out _, out _, out _), startup);
        // Worker identity uses the same raw FILETIME as the terminal process
        // query. Guardian scope retains the existing runtime-status tick basis.
        if (workerCreated <= 0) throw NativeError();
        string workerBirth = workerCreated.ToString(System.Globalization.CultureInfo.InvariantCulture);
        startup.WorkerStarting = false;
        StdioWrite(new { schema = Schema, id, role = StdioRole, @event = "worker-suspended", containment = "windows-job", guardianPid = Environment.ProcessId, birth, workerPid, workerBirth, executableSha256 = digest });
        using (var ack = JsonDocument.Parse(await Task.Run(() => ReadLineBounded(Console.In)).WaitAsync(TimeSpan.FromSeconds(10)) ?? throw NativeError()))
        {
            var a = ack.RootElement; StdioFields(a, "schema", "id", "role", "workerPid", "workerBirth", "executableSha256", "startWorker"); StdioEnvelope(a, id);
            if (a.GetProperty("workerPid").GetUInt32() != workerPid || a.GetProperty("workerBirth").GetString() != workerBirth || a.GetProperty("executableSha256").GetString() != digest || !a.GetProperty("startWorker").GetBoolean()) throw NativeError();
        }
        if (ResumeThread(child.Thread) != 1) throw NativeError();
        StdioWrite(new { schema = Schema, id, role = StdioRole, @event = "running", workerPid, workerBirth });
        using var stopped = new CancellationTokenSource();
        var stateLock = new object(); bool stopping = false, protocolFailed = false; long inputSequence = 0, outputSequence = 0; bool inputPending = false;
        TaskCompletionSource<bool>? outputAck = null;
        var input = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(1) { SingleReader = true, SingleWriter = true });
        void Stop(bool failed)
        {
            lock (stateLock)
            {
                protocolFailed |= failed; if (stopping) return; stopping = true;
                if (!TerminateJobObject(job, 130)) protocolFailed = true;
                stopped.Cancel(); input.Writer.TryComplete(); outputAck?.TrySetCanceled();
            }
        }
        // stdin remains independently readable even if the worker stops reading
        // its input. Parent EOF can always terminate the owned Job.
        var parent = Task.Run(async () =>
        {
            try
            {
                for (;;)
                {
                    string? line = await ReadLineBounded(Console.In, 32768); if (line is null) { Stop(false); return; }
                    using var frame = JsonDocument.Parse(line); var f = frame.RootElement; StdioEnvelope(f, id);
                    string? kind = f.GetProperty("event").GetString();
                    if (kind == "stop") { StdioFields(f, "schema", "id", "role", "event"); Stop(false); return; }
                    if (kind == "output-ack")
                    {
                        StdioFields(f, "schema", "id", "role", "event", "sequence");
                        lock (stateLock) { if (stopping || outputAck is null || outputAck.Task.IsCompleted || f.GetProperty("sequence").GetInt64() != outputSequence) throw NativeError(); outputAck.SetResult(true); }
                    }
                    else if (kind == "input")
                    {
                        StdioFields(f, "schema", "id", "role", "event", "sequence", "bytes");
                        string encoded = f.GetProperty("bytes").GetString() ?? throw NativeError(); byte[] bytes = Convert.FromBase64String(encoded);
                        if (bytes.Length is < 1 or > StdioChunk || Convert.ToBase64String(bytes) != encoded) throw NativeError();
                        lock (stateLock)
                        {
                            if (stopping || inputPending || inputSequence >= 9007199254740990L || f.GetProperty("sequence").GetInt64() != inputSequence + 1) throw NativeError();
                            inputSequence++; inputPending = true; if (!input.Writer.TryWrite(bytes)) throw NativeError();
                        }
                    }
                    else throw NativeError();
                }
            }
            catch { Stop(true); }
        });
        var supply = Task.Run(async () =>
        {
            try
            {
                await foreach (byte[] bytes in input.Reader.ReadAllAsync(stopped.Token))
                {
                    try { await child.Input.WriteAsync(bytes.AsMemory(), stopped.Token); await child.Input.FlushAsync(stopped.Token); }
                    finally { Array.Clear(bytes); }
                    long sequence;
                    lock (stateLock) { if (stopping) return; inputPending = false; sequence = inputSequence; }
                    StdioWrite(new { schema = Schema, id, role = StdioRole, @event = "input-ack", sequence });
                }
            }
            catch { if (!stopped.IsCancellationRequested) Stop(true); }
        });
        var output = Task.Run(async () =>
        {
            var buffer = new byte[StdioChunk];
            try
            {
                int n;
                while ((n = await child.Output.ReadAsync(buffer.AsMemory(), stopped.Token)) != 0)
                {
                    Task ack; long sequence;
                    lock (stateLock)
                    {
                        if (stopping || outputSequence >= 9007199254740990L) throw NativeError();
                        outputSequence++; sequence = outputSequence; outputAck = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously); ack = outputAck.Task;
                    }
                    StdioWrite(new { schema = Schema, id, role = StdioRole, @event = "output", sequence, bytes = Convert.ToBase64String(buffer, 0, n) });
                    await ack.WaitAsync(stopped.Token);
                }
            }
            catch { if (!stopped.IsCancellationRequested) Stop(true); }
            finally { Array.Clear(buffer); }
        });
        var errors = Task.Run(() => Drain(child.Error, 0, null));
        var exit = Task.Run(() => { if (WaitForSingleObject(child.Process, uint.MaxValue) != 0 || !GetExitCodeProcess(child.Process, out uint code)) throw NativeError(); return code; });
        await Task.WhenAny(exit, parent, output); Stop(false);
        uint workerExitCode = await exit.WaitAsync(TimeSpan.FromSeconds(3));
        var watch = Stopwatch.StartNew(); while (ActiveProcesses(job) != 0 && watch.ElapsedMilliseconds < 3000) await Task.Delay(10);
        if (ActiveProcesses(job) != 0) throw NativeError();
        await Task.WhenAll(supply, output, errors).WaitAsync(TimeSpan.FromSeconds(3));
        // A parent reader may still be blocked after spontaneous worker exit.
        // It owns no child/stream writes; process exit closes that inherited pipe.
        if (protocolFailed) throw NativeError();
        StdioWrite(new { schema = Schema, id, role = StdioRole, @event = "stopped", workerExitCode, treeExitVerified = true, containment = "windows-job" });
        return 0;
    }
}
