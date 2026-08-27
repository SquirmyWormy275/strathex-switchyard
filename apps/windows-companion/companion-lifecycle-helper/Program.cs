using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace Sxsy.B122.CompanionLifecycleHelper;

internal static class Program
{
    private const string RequestSchema = "sxsy-b122.companion-supervisor-request";
    private const string StateSchema = "sxsy-b122.companion-supervisor-state";
    private const int MaximumDocumentBytes = 256 * 1024;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint JobObjectTerminate = 0x0008;
    private const uint JobObjectQuery = 0x0004;
    private const uint Synchronize = 0x00100000;
    private const uint Infinite = 0xffffffff;
    private const uint WaitObject0 = 0;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private static readonly IntPtr ProcThreadAttributeHandleList = new(0x00020002);
    private static readonly IntPtr ProcThreadAttributeJobList = new(0x0002000d);
    private static readonly Regex Digest = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SupervisorId = new("^companion:[a-f0-9]{64}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && StringComparer.Ordinal.Equals(args[0], "--self-test")) return SelfTest();
            if (args.Length == 2 && StringComparer.Ordinal.Equals(args[0], "--self-test-child")) return SelfTestChild(args[1]);
            if (args.Length == 1 && StringComparer.Ordinal.Equals(args[0], "--self-test-grandchild")) { Thread.Sleep(TimeSpan.FromMinutes(2)); return 0; }
            if (args.Length == 2 && StringComparer.Ordinal.Equals(args[0], "--process-identity")) return ProcessIdentity(args[1]);
            if (args.Length == 4 && StringComparer.Ordinal.Equals(args[0], "--start")) return StartGeneration(args[1], args[2], args[3]);
            if (args.Length == 3 && StringComparer.Ordinal.Equals(args[0], "--launch")) return Launch(args[1], args[2]);
#if B122_TEST_HOOKS
            if (args.Length == 5 && StringComparer.Ordinal.Equals(args[0], "--test-start-pause-after-create")) return StartGeneration(args[1], args[2], args[3], startPauseMarker: args[4]);
            if (args.Length == 5 && StringComparer.Ordinal.Equals(args[0], "--test-launch-pause-after-child-create")) return StartGeneration(args[1], args[2], args[3], launchPauseMarker: args[4]);
            if (args.Length == 4 && StringComparer.Ordinal.Equals(args[0], "--test-launch-pause-internal")) return Launch(args[1], args[2], args[3]);
#endif
            if (args.Length == 3 && StringComparer.Ordinal.Equals(args[0], "--observe")) return Observe(args[1], args[2]);
            if (args.Length == 3 && StringComparer.Ordinal.Equals(args[0], "--reconcile")) return Reconcile(args[1], args[2]);
            if (args.Length == 5 && StringComparer.Ordinal.Equals(args[0], "--terminate")) return Terminate(args[1], args[2], Bound(args[3], 0, 60_000), Bound(args[4], 1, 60_000));
            Diagnostic("Expected one exact companion-supervisor mode.");
            return 64;
        }
        catch (ProtocolException error) { Diagnostic(error.Message); return error.ExitCode; }
        catch { Diagnostic("The companion Job-Object supervisor failed closed."); return 70; }
    }

    private static int ProcessIdentity(string pidArgument)
    {
        int pid = Bound(pidArgument, 1, int.MaxValue);
        using Process process = Process.GetProcessById(pid);
        if (process.HasExited) throw new ProtocolException(66, "The exact process exited before identity capture.");
        string creation = process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(CultureInfo.InvariantCulture);
        int sessionId = process.SessionId;
        if (process.HasExited) throw new ProtocolException(66, "The exact process exited during identity capture.");
        WriteReceipt(new { schema = "sxsy-b122.windows-process-identity", version = 1, pid, creationFileTimeUtc = creation, sessionId });
        return 0;
    }

    private static int Launch(string requestArgument, string stateArgument, string? pauseAfterChildCreate = null)
    {
        string requestPath = Absolute(requestArgument, "request");
        string statePath = Absolute(stateArgument, "state");
        using FileStream launchTransition = AcquireStateLock(statePath);
        Request request = ReadRequest(requestPath);
        if (!SamePath(request.StatePath, statePath)) throw new ProtocolException(65, "The supervisor state path is confused.");
        VerifySelf(request);
        StartingIntent intent = ReadStartingIntent(StartingIntentPath(request), requestPath, request);
        string currentCreation = Process.GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString(CultureInfo.InvariantCulture);
        if (intent.LaunchPid != Environment.ProcessId || intent.LaunchCreationFileTimeUtc != currentCreation) throw new ProtocolException(65, "The launch process is not the exact reviewed starting generation.");
        if (File.Exists(statePath)) throw new ProtocolException(73, "The supervisor state already exists.");

        // The starter assigns this process to a separate kill-on-close Job
        // before it writes the durable intent.  Open and retain that Job for
        // the entire supervisor lifetime.  If either side dies during the
        // handoff, Windows contains this launcher and every nested child; no
        // path-only receipt is relied upon to discover an unrecorded process.
        using SafeJobHandle startingJob = OpenJobObject(JobObjectTerminate | JobObjectQuery, false, StartingJobName(request.SupervisorId));
        using (Process current = Process.GetCurrentProcess())
        {
            if (startingJob.IsInvalid || !IsProcessInJob(current.SafeHandle, startingJob, out bool assignedToStartingJob) || !assignedToStartingJob) throw new ProtocolException(74, "The launch process is outside its exact starting Job Object.");
        }

        string requestSha256 = Sha256File(requestPath, MaximumDocumentBytes);
        string jobName = JobName(request.SupervisorId);
        using SafeJobHandle job = CreateKillOnCloseJob(jobName);
        using FileStream nodeLock = OpenVerifiedFile(request.NodePath, request.NodeSha256);
        using FileStream mainLock = OpenVerifiedFile(request.MainPath, request.MainSha256);
        using FileStream stdout = OpenLog(request.StdoutPath);
        using FileStream stderr = OpenLog(request.StderrPath);
        using StartedProcess child = StartSuspended(request, stdout.SafeFileHandle, stderr.SafeFileHandle);
#if B122_TEST_HOOKS
        if (pauseAfterChildCreate is not null) PauseAtTestBoundary(pauseAfterChildCreate, child.ProcessId);
#endif
        if (!AssignProcessToJobObject(job, child.ProcessHandle)) { ContainUnassignedSuspendedChild(child.ProcessHandle); throw LastError(74, "The companion could not enter its exact Job Object."); }
        State state = SignState(new State(
            StateSchema, 1, request.SupervisorId, request.BundleRoot, request.BundleId, ResolveSelf(), request.HelperSha256,
            requestSha256, Sha256Text(request.ControlToken), jobName, Environment.ProcessId, child.ProcessId,
            Process.GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString(CultureInfo.InvariantCulture), CreationTime(child.ProcessHandle), DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture),
            "running", null, 1, string.Empty), request.ControlToken);
        WriteStateNew(statePath, state);
        File.Delete(StartingIntentPath(request));
        if (ResumeThread(child.ThreadHandle) == uint.MaxValue) { _ = TerminateJobObject(job, 130); State current = TryReadState(statePath, requestPath, request) ?? state; if (current.Status != "terminated") WriteStateReplace(statePath, SignState(current with { Status = "failed_contained", ExitCode = 130, ActiveProcesses = 0, AuthenticationTag = string.Empty }, request.ControlToken)); throw LastError(74, "The exact companion process could not resume."); }
        child.ThreadHandle.Dispose();
        launchTransition.Dispose();

        uint wait = WaitForSingleObject(child.ProcessHandle, Infinite);
        if (wait != WaitObject0) throw LastError(74, "The exact companion process wait failed.");
        if (!GetExitCodeProcess(child.ProcessHandle, out uint exitCode)) throw LastError(74, "The exact companion exit code is unavailable.");
        uint active = ActiveProcessCount(job);
        string terminal;
        if (active > 0)
        {
            if (!TerminateJobObject(job, 130) || !WaitUntil(() => ActiveProcessCount(job) == 0, 5_000)) throw new ProtocolException(75, "Descendants survived the direct companion process and could not be contained.");
            active = 0;
            terminal = "contained_after_parent_exit";
        }
        else terminal = exitCode == 0 ? "clean_exit" : "failed_contained";
        using (AcquireStateLock(statePath))
        {
            State current = TryReadState(statePath, requestPath, request) ?? state;
            // A concurrent reviewed terminator owns the stronger terminal receipt.
            // The launcher must never regress it after its root child wakes/exits.
            if (current.Status == "terminated") terminal = "terminated";
            int terminalExitCode = current.Status == "terminated" && current.ExitCode.HasValue ? current.ExitCode.Value : checked((int)exitCode);
            WriteStateReplace(statePath, SignState(current with { Status = terminal, ExitCode = terminalExitCode, ActiveProcesses = checked((int)active), AuthenticationTag = string.Empty }, request.ControlToken));
        }
        return terminal == "clean_exit" ? 0 : 1;
    }

    private static int StartGeneration(string requestArgument, string stateArgument, string intentArgument, string? startPauseMarker = null, string? launchPauseMarker = null)
    {
        string requestPath = Absolute(requestArgument, "request"), statePath = Absolute(stateArgument, "state"), intentPath = Absolute(intentArgument, "starting intent");
        using FileStream transition = AcquireStateLock(statePath);
        Request request = ReadRequest(requestPath); VerifySelf(request);
        if (!SamePath(request.StatePath, statePath) || !SamePath(intentPath, StartingIntentPath(request))) throw new ProtocolException(65, "The supervisor starter paths are confused.");
        if (File.Exists(statePath) || File.Exists(intentPath)) throw new ProtocolException(73, "A companion supervisor generation is already starting or active.");
        using SafeJobHandle startingJob = CreateKillOnCloseJob(StartingJobName(request.SupervisorId));
        // PROC_THREAD_ATTRIBUTE_JOB_LIST binds the suspended launcher to the
        // kill-on-close Job as part of CreateProcess itself.  There is no
        // post-create/pre-assign process that can escape if this starter is
        // killed at the syscall boundary.
        using StartedProcess launcher = StartSelfSuspended(requestPath, statePath, request.BundleRoot, startingJob, launchPauseMarker);
        StartingIntent intent;
        try
        {
#if B122_TEST_HOOKS
            if (startPauseMarker is not null) PauseAtTestBoundary(startPauseMarker, launcher.ProcessId);
#endif
            intent = SignStartingIntent(new StartingIntent("sxsy-b122.companion-supervisor-starting", 1, request.SupervisorId, Sha256File(requestPath, MaximumDocumentBytes), ResolveSelf(), request.HelperSha256, launcher.ProcessId, CreationTime(launcher.ProcessHandle), DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture), "starting", string.Empty), request.ControlToken);
            WriteStartingIntentNew(intentPath, intent);
            if (ResumeThread(launcher.ThreadHandle) == uint.MaxValue) throw LastError(74, "The exact companion supervisor could not resume.");
            launcher.ThreadHandle.Dispose();
            transition.Dispose();

            // Keep the starter's Job handle alive until the launcher has
            // opened its own handle and durably published authenticated state.
            // A timeout terminates the whole handoff Job, including a child
            // that might already be nested in the final companion Job.
            State? published = null;
            if (!WaitUntil(() => (published = TryReadState(statePath, requestPath, request)) is not null && published.SupervisorPid == launcher.ProcessId && published.SupervisorCreationFileTimeUtc == intent.LaunchCreationFileTimeUtc, 7_500))
            {
                if (!TerminateJobObject(startingJob, 130) || !WaitUntil(() => ActiveProcessCount(startingJob) == 0, 5_000)) throw new ProtocolException(75, "The starting supervisor handoff retained a process after timeout.");
                using FileStream cleanupTransition = AcquireStateLock(statePath);
                if (!File.Exists(statePath) && File.Exists(intentPath)) File.Delete(intentPath);
                throw new ProtocolException(75, "The starting supervisor did not publish its authenticated state in time.");
            }
            WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-start", version = 1, supervisorId = request.SupervisorId, status = "started", supervisorPid = launcher.ProcessId, supervisorCreationFileTimeUtc = intent.LaunchCreationFileTimeUtc });
            return 0;
        }
        catch
        {
            _ = TerminateJobObject(startingJob, 130);
            _ = WaitUntil(() => ActiveProcessCount(startingJob) == 0, 5_000);
            throw;
        }
    }

    private static int Observe(string requestArgument, string stateArgument)
    {
        string requestPath = Absolute(requestArgument, "request");
        string statePath = Absolute(stateArgument, "state");
        Request request = ReadRequest(requestPath);
        VerifySelf(request);
        string status; uint active;
        using (AcquireStateLock(statePath))
        {
            State state = ReadState(statePath, requestPath, request);
            using SafeJobHandle job = OpenJobObject(JobObjectQuery, false, state.JobName);
            active = job.IsInvalid ? 0 : ActiveProcessCount(job);
            if (active > 0) status = "active";
            else if (state.Status is "clean_exit" or "terminated" or "contained_after_parent_exit" or "failed_contained" or "contained_after_supervisor_exit") status = state.Status;
            else if (!ExactProcessExists(state.SupervisorPid, state.SupervisorCreationFileTimeUtc))
            {
                // A signed running receipt plus an absent exact supervisor and an
                // absent/empty named Job proves kill-on-close containment ran. A
                // reused PID is deliberately treated as foreign, never targeted.
                status = state.Status == "failed" ? "failed_contained" : "contained_after_supervisor_exit";
                state = SignState(state with { Status = status, ExitCode = state.ExitCode ?? 130, ActiveProcesses = 0, AuthenticationTag = string.Empty }, request.ControlToken);
                WriteStateReplace(statePath, state);
            }
            else status = "absent_ambiguous";
        }
        WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-observation", version = 1, supervisorId = request.SupervisorId, status, activeProcesses = active });
        return active > 0 ? 0 : status is "clean_exit" or "terminated" or "contained_after_parent_exit" or "failed_contained" or "contained_after_supervisor_exit" ? 1 : 2;
    }

    private static int Reconcile(string requestArgument, string stateArgument)
    {
        string requestPath = Absolute(requestArgument, "request"), statePath = Absolute(stateArgument, "state");
        Request request; bool stateExists; string? terminalStatus = null;
        using (FileStream transition = AcquireStateLock(statePath))
        {
            request = ReadRequest(requestPath); VerifySelf(request);
            if (!SamePath(request.StatePath, statePath)) throw new ProtocolException(65, "The supervisor state path is confused.");
            stateExists = File.Exists(statePath);
            if (!stateExists)
            {
                string intentPath = StartingIntentPath(request);
                if (File.Exists(intentPath))
                {
                    StartingIntent intent = ReadStartingIntent(intentPath, requestPath, request);
                    using SafeJobHandle startingJob = OpenJobObject(JobObjectTerminate | JobObjectQuery, false, StartingJobName(request.SupervisorId));
                    if (!startingJob.IsInvalid)
                    {
                        if (!TerminateJobObject(startingJob, 130) || !WaitUntil(() => ActiveProcessCount(startingJob) == 0, 5_000)) throw new ProtocolException(75, "The exact starting supervisor Job could not be contained.");
                    }
                    else if (ExactProcessExists(intent.LaunchPid, intent.LaunchCreationFileTimeUtc))
                    {
                        WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-observation", version = 1, supervisorId = request.SupervisorId, status = "request_only_ambiguous", activeProcesses = 1 });
                        return 2;
                    }
                    if (File.Exists(intentPath)) File.Delete(intentPath);
                    terminalStatus = "request_only_contained";
                }
                using SafeJobHandle job = OpenJobObject(JobObjectQuery, false, JobName(request.SupervisorId));
                if (!job.IsInvalid)
                {
                    uint active = ActiveProcessCount(job);
                    WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-observation", version = 1, supervisorId = request.SupervisorId, status = "request_only_ambiguous", activeProcesses = active });
                    return 2;
                }
                terminalStatus ??= "request_only_absent";
            }
        }
        if (stateExists) return Observe(requestPath, statePath);
        WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-observation", version = 1, supervisorId = request.SupervisorId, status = terminalStatus, activeProcesses = 0 });
        return 1;
    }

    private static int Terminate(string requestArgument, string stateArgument, int gracefulMs, int forceMs)
    {
        string requestPath = Absolute(requestArgument, "request");
        string statePath = Absolute(stateArgument, "state");
        Request request = ReadRequest(requestPath);
        VerifySelf(request);
        using (AcquireStateLock(statePath))
        {
            State state = ReadState(statePath, requestPath, request);
            using SafeJobHandle job = OpenJobObject(JobObjectTerminate | JobObjectQuery, false, state.JobName);
            if (job.IsInvalid)
            {
                if (state.Status is not ("clean_exit" or "terminated" or "contained_after_parent_exit" or "failed_contained" or "contained_after_supervisor_exit")) throw new ProtocolException(74, "The bound companion Job Object disappeared without a terminal receipt.");
                WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-termination", version = 1, supervisorId = request.SupervisorId, status = "already_absent", activeProcesses = 0 });
                return 0;
            }
            if (gracefulMs > 0) WaitUntil(() => ActiveProcessCount(job) == 0, gracefulMs);
            if (ActiveProcessCount(job) > 0 && !TerminateJobObject(job, 130)) throw LastError(74, "The exact companion Job Object rejected termination.");
            if (!WaitUntil(() => ActiveProcessCount(job) == 0, forceMs)) throw new ProtocolException(75, "The exact companion Job Object retained survivors.");
            State terminal = SignState(state with { Status = "terminated", ExitCode = 130, ActiveProcesses = 0, AuthenticationTag = string.Empty }, request.ControlToken);
            WriteStateReplace(statePath, terminal);
        }
        WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-termination", version = 1, supervisorId = request.SupervisorId, status = "terminated", activeProcesses = 0 });
        return 0;
    }

    private static int SelfTest()
    {
        string root = Path.Combine(Path.GetTempPath(), "sxsy-b122-companion-job-" + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture));
        Directory.CreateDirectory(root);
        string marker = Path.Combine(root, "tree.txt");
        string name = "Global\\SxsyB122Companion-SelfTest-" + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture);
        using SafeJobHandle job = CreateKillOnCloseJob(name);
        string self = ResolveSelf();
        using SafeFileHandle nullOutput = CreateFileW("NUL", 0x40000000, 0x00000001 | 0x00000002, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
        using SafeFileHandle nullError = CreateFileW("NUL", 0x40000000, 0x00000001 | 0x00000002, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
        if (nullOutput.IsInvalid || nullError.IsInvalid) throw LastError(74, "The self-test null output is unavailable.");
        var request = new Request(RequestSchema, 1, "companion:" + new string('a', 64), root, new string('b', 64), self, new string('c', 64), self, new string('d', 64), self, new string('e', 64), new[] { "--self-test-child", marker }, root, root, Path.Combine(root, "out.log"), Path.Combine(root, "err.log"), new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["SystemRoot"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows), ["WINDIR"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows) }, new string('f', 64), Path.Combine(root, "state.json"));
        using StartedProcess child = StartSuspended(request, nullOutput, nullError);
        if (!AssignProcessToJobObject(job, child.ProcessHandle)) { ContainUnassignedSuspendedChild(child.ProcessHandle); throw LastError(74, "Self-test child could not enter the Job Object."); }
        if (ResumeThread(child.ThreadHandle) == uint.MaxValue) { _ = TerminateJobObject(job, 130); throw LastError(74, "Self-test child could not resume."); }
        child.ThreadHandle.Dispose();
        if (!WaitUntil(() => File.Exists(marker) && ActiveProcessCount(job) >= 2, 15_000)) throw new ProtocolException(75, "Self-test did not observe the contained child tree.");
        int[] pids = File.ReadAllText(marker).Split(',').Select(value => int.Parse(value, CultureInfo.InvariantCulture)).ToArray();
        if (!TerminateJobObject(job, 130) || !WaitUntil(() => ActiveProcessCount(job) == 0, 15_000)) throw new ProtocolException(75, "Self-test Job Object retained a survivor.");
        if (pids.Any(ProcessExists)) throw new ProtocolException(75, "Self-test child identity survived Job-Object termination.");
        WriteReceipt(new { schema = "sxsy-b122.companion-supervisor-self-test", version = 1, status = "passed", capturedProcesses = pids.Length, activeProcesses = 0 });
        try { Directory.Delete(root, true); }
        catch (IOException) { Thread.Sleep(100); Directory.Delete(root, true); }
        catch (UnauthorizedAccessException) { Thread.Sleep(100); Directory.Delete(root, true); }
        return 0;
    }

    private static int SelfTestChild(string marker)
    {
        string path = Absolute(marker, "self-test marker");
        using Process grandchild = Process.Start(new ProcessStartInfo(ResolveSelf(), "--self-test-grandchild") { UseShellExecute = false, CreateNoWindow = true }) ?? throw new ProtocolException(74, "Self-test grandchild failed to start.");
        File.WriteAllText(path, Environment.ProcessId.ToString(CultureInfo.InvariantCulture) + "," + grandchild.Id.ToString(CultureInfo.InvariantCulture), new UTF8Encoding(false));
        Thread.Sleep(TimeSpan.FromMinutes(2));
        return 0;
    }

    private static Request ReadRequest(string path)
    {
        byte[] bytes = ReadBounded(path, MaximumDocumentBytes, "request");
        using JsonDocument document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 8 });
        JsonElement root = ExactObject(document.RootElement, new[] { "schema", "version", "supervisorId", "bundleRoot", "bundleId", "helperPath", "helperSha256", "nodePath", "nodeSha256", "mainPath", "mainSha256", "arguments", "workingDirectory", "stateRoot", "stdoutPath", "stderrPath", "environment", "controlToken", "statePath" }, "request");
        var request = new Request(
            Required(root, "schema", 128), RequiredInt(root, "version", 1, 1), Required(root, "supervisorId", 80), Absolute(Required(root, "bundleRoot", 4096), "bundle root"), RequiredDigest(root, "bundleId"),
            Absolute(Required(root, "helperPath", 4096), "helper"), RequiredDigest(root, "helperSha256"), Absolute(Required(root, "nodePath", 4096), "node"), RequiredDigest(root, "nodeSha256"),
            Absolute(Required(root, "mainPath", 4096), "main"), RequiredDigest(root, "mainSha256"), ReadStrings(root.GetProperty("arguments")), Absolute(Required(root, "workingDirectory", 4096), "working directory"),
            Absolute(Required(root, "stateRoot", 4096), "state root"), Absolute(Required(root, "stdoutPath", 4096), "stdout"), Absolute(Required(root, "stderrPath", 4096), "stderr"), ReadEnvironment(root.GetProperty("environment")),
            RequiredDigest(root, "controlToken"), Absolute(Required(root, "statePath", 4096), "state"));
        ValidateRequest(request);
        return request;
    }

    private static void ValidateRequest(Request request)
    {
        if (request.Schema != RequestSchema || request.Version != 1 || !SupervisorId.IsMatch(request.SupervisorId)) throw new ProtocolException(65, "The companion supervisor request identity is invalid.");
        string bundle = CanonicalDirectory(request.BundleRoot, "bundle root");
        if (!SamePath(request.WorkingDirectory, bundle) || !SamePath(request.NodePath, Path.Combine(bundle, "runtime", "node.exe")) || !SamePath(request.MainPath, Path.Combine(bundle, "app", "dist", "apps", "windows-companion", "src", "main.js"))) throw new ProtocolException(65, "The supervisor is restricted to the packaged companion entry point.");
        string state = CanonicalDirectory(request.StateRoot, "state root");
        if (!SamePath(request.StatePath, Path.Combine(state, "companion-supervisor.state.json")) || !SamePath(request.StdoutPath, Path.Combine(state, "logs", "companion.stdout.log")) || !SamePath(request.StderrPath, Path.Combine(state, "logs", "companion.stderr.log"))) throw new ProtocolException(65, "The supervisor control/log paths escaped the exact state root.");
        if (request.Arguments.Count is not (1 or 3) || !SamePath(request.Arguments[0], request.MainPath) || request.Arguments.Count == 3 && (request.Arguments[1] != "--isolated-test-state-directory" || !SamePath(request.Arguments[2], state))) throw new ProtocolException(65, "The companion arguments are outside the fixed packaged contract.");
        string[] environmentKeys = request.Environment.Keys.OrderBy(item => item, StringComparer.OrdinalIgnoreCase).ToArray();
        string[] expectedEnvironmentKeys = new[] { "APPDATA", "LOCALAPPDATA", "SXSY_B122_COMPANION_SUPERVISOR_REQUEST", "SXSY_B122_COMPANION_SUPERVISOR_STATE", "SystemRoot", "TEMP", "TMP", "WINDIR" }.OrderBy(item => item, StringComparer.OrdinalIgnoreCase).ToArray();
        if (!environmentKeys.SequenceEqual(expectedEnvironmentKeys, StringComparer.OrdinalIgnoreCase) || request.Environment.Any(item => item.Value.Length is < 1 or > 32767 || item.Value.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0) || request.Environment.Sum(item => item.Key.Length + item.Value.Length + 2) > 65535) throw new ProtocolException(65, "The companion environment is invalid or secret-bearing.");
        if (!request.Environment.TryGetValue("SXSY_B122_COMPANION_SUPERVISOR_REQUEST", out string? requestPath) || !request.Environment.TryGetValue("SXSY_B122_COMPANION_SUPERVISOR_STATE", out string? statePath) || !SamePath(statePath, request.StatePath) || !SamePath(requestPath, Path.Combine(state, "companion-supervisor.request.json"))) throw new ProtocolException(65, "The companion environment lacks its exact supervisor binding.");
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows), local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        if (!SamePath(request.Environment["SystemRoot"], windows) || !SamePath(request.Environment["WINDIR"], windows) || !SamePath(request.Environment["LOCALAPPDATA"], local) || !SamePath(request.Environment["APPDATA"], roaming) || !SamePath(request.Environment["TEMP"], request.Environment["TMP"])) throw new ProtocolException(65, "The companion environment is not bound to Windows Known Folders.");
        string temporary = CanonicalDirectory(request.Environment["TEMP"], "supervisor temporary directory");
        EnsureNoReparse(state, temporary);
        EnsureNoReparse(bundle, request.NodePath); EnsureNoReparse(bundle, request.MainPath); EnsureNoReparse(state, request.StatePath, allowAbsentLeaf: true); EnsureNoReparse(state, request.StdoutPath, allowAbsentLeaf: true); EnsureNoReparse(state, request.StderrPath, allowAbsentLeaf: true);
    }

    private static State ReadState(string statePath, string requestPath, Request request) => TryReadState(statePath, requestPath, request) ?? throw new ProtocolException(65, "The companion supervisor state is absent, malformed, or unauthenticated.");

    private static State? TryReadState(string statePath, string requestPath, Request request)
    {
        try
        {
            byte[] bytes = ReadBounded(statePath, MaximumDocumentBytes, "state");
            using JsonDocument document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 5 });
            JsonElement root = ExactObject(document.RootElement, new[] { "schema", "version", "supervisorId", "bundleRoot", "bundleId", "helperPath", "helperSha256", "requestSha256", "controlTokenSha256", "jobName", "supervisorPid", "childPid", "supervisorCreationFileTimeUtc", "childCreationFileTimeUtc", "startedAt", "status", "exitCode", "activeProcesses", "authenticationTag" }, "state");
            var value = new State(Required(root, "schema", 128), RequiredInt(root, "version", 1, 1), Required(root, "supervisorId", 80), Absolute(Required(root, "bundleRoot", 4096), "state bundle"), RequiredDigest(root, "bundleId"), Absolute(Required(root, "helperPath", 4096), "state helper"), RequiredDigest(root, "helperSha256"), RequiredDigest(root, "requestSha256"), RequiredDigest(root, "controlTokenSha256"), Required(root, "jobName", 128), RequiredInt(root, "supervisorPid", 1, int.MaxValue), RequiredInt(root, "childPid", 1, int.MaxValue), Required(root, "supervisorCreationFileTimeUtc", 32), Required(root, "childCreationFileTimeUtc", 32), Required(root, "startedAt", 64), Required(root, "status", 32), root.GetProperty("exitCode").ValueKind == JsonValueKind.Null ? null : RequiredInt(root, "exitCode", int.MinValue, int.MaxValue), RequiredInt(root, "activeProcesses", 0, int.MaxValue), RequiredDigest(root, "authenticationTag"));
            if (value.Schema != StateSchema || value.Version != 1 || value.SupervisorId != request.SupervisorId || !SamePath(value.BundleRoot, request.BundleRoot) || value.BundleId != request.BundleId || !SamePath(value.HelperPath, request.HelperPath) || value.HelperSha256 != request.HelperSha256 || value.RequestSha256 != Sha256File(requestPath, MaximumDocumentBytes) || value.ControlTokenSha256 != Sha256Text(request.ControlToken) || value.JobName != JobName(request.SupervisorId) || !Regex.IsMatch(value.SupervisorCreationFileTimeUtc, "^[1-9][0-9]{10,19}$", RegexOptions.CultureInvariant) || !Regex.IsMatch(value.ChildCreationFileTimeUtc, "^[1-9][0-9]{10,19}$", RegexOptions.CultureInvariant) || !DateTimeOffset.TryParseExact(value.StartedAt, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _) || value.Status is not ("running" or "clean_exit" or "terminated" or "contained_after_parent_exit" or "failed" or "failed_contained" or "contained_after_supervisor_exit" or "ambiguous")) return null;
            string expected = SignState(value with { AuthenticationTag = string.Empty }, request.ControlToken).AuthenticationTag;
            return FixedEquals(value.AuthenticationTag, expected) ? value : null;
        }
        catch (IOException) { return null; }
        catch (JsonException) { return null; }
        catch (ProtocolException) { return null; }
    }

    private static string StartingIntentPath(Request request) => Path.Combine(request.StateRoot, "companion-supervisor.starting.json");

    private static StartingIntent ReadStartingIntent(string path, string requestPath, Request request)
    {
        byte[] bytes = ReadBounded(path, MaximumDocumentBytes, "starting intent");
        try
        {
            using JsonDocument document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 4 });
            JsonElement root = ExactObject(document.RootElement, new[] { "schema", "version", "supervisorId", "requestSha256", "helperPath", "helperSha256", "launchPid", "launchCreationFileTimeUtc", "startedAt", "status", "authenticationTag" }, "starting intent");
            var value = new StartingIntent(Required(root, "schema", 128), RequiredInt(root, "version", 1, 1), Required(root, "supervisorId", 80), RequiredDigest(root, "requestSha256"), Absolute(Required(root, "helperPath", 4096), "intent helper"), RequiredDigest(root, "helperSha256"), RequiredInt(root, "launchPid", 1, int.MaxValue), Required(root, "launchCreationFileTimeUtc", 32), Required(root, "startedAt", 64), Required(root, "status", 32), RequiredDigest(root, "authenticationTag"));
            if (value.Schema != "sxsy-b122.companion-supervisor-starting" || value.Version != 1 || value.SupervisorId != request.SupervisorId || value.RequestSha256 != Sha256File(requestPath, MaximumDocumentBytes) || !SamePath(value.HelperPath, request.HelperPath) || value.HelperSha256 != request.HelperSha256 || !Regex.IsMatch(value.LaunchCreationFileTimeUtc, "^[1-9][0-9]{10,19}$", RegexOptions.CultureInvariant) || !DateTimeOffset.TryParseExact(value.StartedAt, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _) || value.Status != "starting") throw new ProtocolException(65, "The companion starting intent is stale or confused.");
            string expected = SignStartingIntent(value with { AuthenticationTag = string.Empty }, request.ControlToken).AuthenticationTag;
            if (!FixedEquals(value.AuthenticationTag, expected)) throw new ProtocolException(65, "The companion starting intent is unauthenticated.");
            return value;
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    private static StartingIntent SignStartingIntent(StartingIntent value, string token)
    {
        byte[] key = Convert.FromHexString(token), bytes = JsonSerializer.SerializeToUtf8Bytes(value with { AuthenticationTag = string.Empty }, JsonOptions);
        try { using var hmac = new HMACSHA256(key); return value with { AuthenticationTag = Convert.ToHexString(hmac.ComputeHash(bytes)).ToLowerInvariant() }; }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(bytes); }
    }

    private static State SignState(State state, string token)
    {
        byte[] key = Convert.FromHexString(token);
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(state with { AuthenticationTag = string.Empty }, JsonOptions);
        try { using var hmac = new HMACSHA256(key); return state with { AuthenticationTag = Convert.ToHexString(hmac.ComputeHash(bytes)).ToLowerInvariant() }; }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(bytes); }
    }

    private static StartedProcess StartSuspended(Request request, SafeFileHandle stdout, SafeFileHandle stderr)
    {
        using SafeFileHandle input = CreateFileW("NUL", 0x80000000, 0x00000001 | 0x00000002, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
        if (input.IsInvalid || !SetHandleInformation(input.DangerousGetHandle(), HandleFlagInherit, HandleFlagInherit) || !SetHandleInformation(stdout.DangerousGetHandle(), HandleFlagInherit, HandleFlagInherit) || !SetHandleInformation(stderr.DangerousGetHandle(), HandleFlagInherit, HandleFlagInherit)) throw LastError(74, "The companion standard handles could not be restricted.");
        var startup = new StartupInfoEx { StartupInfo = new StartupInfo { cb = Marshal.SizeOf<StartupInfoEx>(), dwFlags = StartfUseStdHandles, hStdInput = input.DangerousGetHandle(), hStdOutput = stdout.DangerousGetHandle(), hStdError = stderr.DangerousGetHandle() } };
        IntPtr listSize = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize); startup.AttributeList = Marshal.AllocHGlobal(listSize); IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 3); IntPtr environment = Marshal.StringToHGlobalUni(EnvironmentBlock(request.Environment));
        try
        {
            if (!InitializeProcThreadAttributeList(startup.AttributeList, 1, 0, ref listSize)) throw LastError(74, "The companion handle list could not initialize.");
            Marshal.WriteIntPtr(handles, 0, input.DangerousGetHandle()); Marshal.WriteIntPtr(handles, IntPtr.Size, stdout.DangerousGetHandle()); Marshal.WriteIntPtr(handles, IntPtr.Size * 2, stderr.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(startup.AttributeList, 0, ProcThreadAttributeHandleList, handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) throw LastError(74, "The companion inherited-handle list could not be restricted.");
            string command = BuildCommandLine(request.NodePath, request.Arguments); bool created = CreateProcessW(request.NodePath, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | CreateNoWindow | CreateUnicodeEnvironment | ExtendedStartupInfoPresent, environment, request.WorkingDirectory, ref startup, out ProcessInformation info);
            if (!created) throw LastError(74, "The packaged companion process could not start suspended.");
            return new StartedProcess(new SafeFileHandle(info.hProcess, true), new SafeFileHandle(info.hThread, true), checked((int)info.dwProcessId));
        }
        finally { if (startup.AttributeList != IntPtr.Zero) DeleteProcThreadAttributeList(startup.AttributeList); Marshal.FreeHGlobal(handles); Marshal.FreeHGlobal(startup.AttributeList); Marshal.FreeHGlobal(environment); }
    }

    private static StartedProcess StartSelfSuspended(string requestPath, string statePath, string workingDirectory, SafeJobHandle startingJob, string? launchPauseMarker)
    {
        string self = ResolveSelf();
        var startup = new StartupInfoEx { StartupInfo = new StartupInfo { cb = Marshal.SizeOf<StartupInfoEx>() } };
#if B122_TEST_HOOKS
        IReadOnlyList<string> launchArguments = launchPauseMarker is null ? new[] { "--launch", requestPath, statePath } : new[] { "--test-launch-pause-internal", requestPath, statePath, Absolute(launchPauseMarker, "test marker") };
#else
        IReadOnlyList<string> launchArguments = new[] { "--launch", requestPath, statePath };
#endif
        string command = BuildCommandLine(self, launchArguments);
        IntPtr listSize = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize); startup.AttributeList = Marshal.AllocHGlobal(listSize); IntPtr jobs = Marshal.AllocHGlobal(IntPtr.Size);
        try
        {
            if (!InitializeProcThreadAttributeList(startup.AttributeList, 1, 0, ref listSize)) throw LastError(74, "The starting supervisor Job list could not initialize.");
            Marshal.WriteIntPtr(jobs, startingJob.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(startup.AttributeList, 0, ProcThreadAttributeJobList, jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw LastError(74, "The starting supervisor Job list could not be bound.");
            if (!CreateProcessW(self, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false, CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent, IntPtr.Zero, workingDirectory, ref startup, out ProcessInformation info)) throw LastError(74, "The exact companion supervisor generation could not start suspended in its Job Object.");
            return new StartedProcess(new SafeFileHandle(info.hProcess, true), new SafeFileHandle(info.hThread, true), checked((int)info.dwProcessId));
        }
        finally
        {
            if (startup.AttributeList != IntPtr.Zero) DeleteProcThreadAttributeList(startup.AttributeList);
            Marshal.FreeHGlobal(jobs);
            Marshal.FreeHGlobal(startup.AttributeList);
        }
    }

    private static string BuildCommandLine(string executable, IReadOnlyList<string> args) => string.Join(" ", new[] { Quote(executable) }.Concat(args.Select(Quote)));
    private static string Quote(string value) { if (value.IndexOf('\0') >= 0 || value.IndexOf('\r') >= 0 || value.IndexOf('\n') >= 0) throw new ProtocolException(65, "A companion argument is invalid."); var result = new StringBuilder("\""); int slashes = 0; foreach (char c in value) { if (c == '\\') { slashes++; continue; } if (c == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; } result.Append('\\', slashes).Append(c); slashes = 0; } result.Append('\\', slashes * 2).Append('"'); return result.ToString(); }
    private static string EnvironmentBlock(IReadOnlyDictionary<string, string> environment) => string.Concat(environment.OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase).Select(item => item.Key + "=" + item.Value + "\0")) + "\0";

    private static SafeJobHandle CreateKillOnCloseJob(string name) { SafeJobHandle job = CreateJobObjectW(IntPtr.Zero, name); int creationError = Marshal.GetLastWin32Error(); if (job.IsInvalid) throw new ProtocolException(74, "The exact companion Job Object could not be created. Win32=" + creationError.ToString(CultureInfo.InvariantCulture)); if (creationError == 183) { job.Dispose(); throw new ProtocolException(73, "The exact companion Job Object name is already owned by another generation."); } var info = new JobObjectExtendedLimitInformation { BasicLimitInformation = new JobObjectBasicLimitInformation { LimitFlags = JobObjectLimitKillOnJobClose } }; int size = Marshal.SizeOf<JobObjectExtendedLimitInformation>(); IntPtr pointer = Marshal.AllocHGlobal(size); try { Marshal.StructureToPtr(info, pointer, false); if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, pointer, (uint)size)) throw LastError(74, "Kill-on-close containment could not be established."); return job; } catch { job.Dispose(); throw; } finally { Marshal.FreeHGlobal(pointer); } }
    private static uint ActiveProcessCount(SafeJobHandle job) { int size = Marshal.SizeOf<JobObjectBasicAccountingInformationNative>(); IntPtr pointer = Marshal.AllocHGlobal(size); try { if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, pointer, (uint)size, IntPtr.Zero)) throw LastError(74, "The exact companion Job Object could not be queried."); return Marshal.PtrToStructure<JobObjectBasicAccountingInformationNative>(pointer).ActiveProcesses; } finally { Marshal.FreeHGlobal(pointer); } }
    private static bool WaitUntil(Func<bool> condition, int milliseconds) { var timer = Stopwatch.StartNew(); do { if (condition()) return true; Thread.Sleep(25); } while (timer.ElapsedMilliseconds < milliseconds); return condition(); }
#if B122_TEST_HOOKS
    private static void PauseAtTestBoundary(string marker, int capturedPid)
    {
        string path = Absolute(marker, "test marker");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, capturedPid.ToString(CultureInfo.InvariantCulture), new UTF8Encoding(false));
        Thread.Sleep(TimeSpan.FromMinutes(2));
    }
#endif
    private static FileStream AcquireStateLock(string statePath) { string path = statePath + ".lock"; var timer = Stopwatch.StartNew(); while (true) { try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.WriteThrough); } catch (IOException) { if (timer.ElapsedMilliseconds >= 5_000) throw new ProtocolException(75, "The companion supervisor state transition lock timed out."); Thread.Sleep(25); } } }
    private static void ContainUnassignedSuspendedChild(SafeFileHandle process) { _ = TerminateProcess(process, 130); if (WaitForSingleObject(process, 5_000) != WaitObject0) throw new ProtocolException(75, "An unassigned suspended companion process could not be proven absent."); }
    private static bool ProcessExists(int pid) { try { using Process process = Process.GetProcessById(pid); return !process.HasExited; } catch (ArgumentException) { return false; } catch (InvalidOperationException) { return false; } catch (System.ComponentModel.Win32Exception) { return false; } }
    private static bool ExactProcessExists(int pid, string creationFileTimeUtc) { try { using Process process = Process.GetProcessById(pid); return !process.HasExited && process.StartTime.ToUniversalTime().ToFileTimeUtc().ToString(CultureInfo.InvariantCulture) == creationFileTimeUtc; } catch (ArgumentException) { return false; } catch (InvalidOperationException) { return false; } }
    private static string CreationTime(SafeFileHandle process) { if (!GetProcessTimes(process, out FileTime created, out _, out _, out _)) throw LastError(74, "The companion creation identity is unavailable."); return (((ulong)created.High << 32) | created.Low).ToString(CultureInfo.InvariantCulture); }

    private static FileStream OpenVerifiedFile(string path, string digest) { var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.SequentialScan); try { if (stream.Length < 1 || stream.Length > 512L * 1024 * 1024 || !FixedEquals(Sha256Stream(stream), digest)) throw new ProtocolException(65, "A packaged companion executable/module digest changed."); stream.Position = 0; return stream; } catch { stream.Dispose(); throw; } }
    private static FileStream OpenLog(string path) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); EnsureNoReparse(Path.GetDirectoryName(Path.GetDirectoryName(path)!)!, path, allowAbsentLeaf: true); var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read, 4096, FileOptions.WriteThrough); try { if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new ProtocolException(65, "A companion log leaf became a reparse point during open."); return stream; } catch { stream.Dispose(); throw; } }
    private static void VerifySelf(Request request) { string self = ResolveSelf(); if (!SamePath(self, request.HelperPath) || !FixedEquals(Sha256File(self, 512 * 1024 * 1024), request.HelperSha256) || !StringComparer.OrdinalIgnoreCase.Equals(Path.GetFileName(self), "b122-companion-supervisor.exe")) throw new ProtocolException(65, "The companion supervisor helper identity changed."); }
    private static string ResolveSelf() => Path.GetFullPath(Environment.ProcessPath ?? throw new ProtocolException(70, "The supervisor executable identity is unavailable."));
    private static string JobName(string id) => "Global\\SxsyB122Companion-" + id["companion:".Length..];
    private static string StartingJobName(string id) => "Global\\SxsyB122CompanionStarting-" + id["companion:".Length..];
    private static string CanonicalDirectory(string path, string label) { string full = Absolute(path, label); if (!Directory.Exists(full) || (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new ProtocolException(65, $"The {label} is absent or a reparse directory."); string canonical = new DirectoryInfo(full).FullName; if (!SamePath(canonical, full)) throw new ProtocolException(65, $"The {label} changed canonical identity."); return canonical; }
    private static void EnsureNoReparse(string root, string path, bool allowAbsentLeaf = false) { string relative = Path.GetRelativePath(root, path); if (Path.IsPathFullyQualified(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new ProtocolException(65, "A companion path escaped its root."); string current = root; string[] parts = relative.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries); for (int index = 0; index < parts.Length; index++) { current = Path.Combine(current, parts[index]); if (!File.Exists(current) && !Directory.Exists(current)) { if (allowAbsentLeaf && index == parts.Length - 1) break; throw new ProtocolException(65, "A companion path has an absent intermediate ancestor: " + current); } if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new ProtocolException(65, "A companion path traverses a reparse point."); } }
    private static string Absolute(string value, string label) { if (string.IsNullOrWhiteSpace(value) || value.IndexOf('\0') >= 0 || !Path.IsPathFullyQualified(value)) throw new ProtocolException(65, $"The {label} path is invalid."); return Path.GetFullPath(value); }
    private static bool SamePath(string left, string right) => StringComparer.OrdinalIgnoreCase.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(left)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(right)));
    private static int Bound(string value, int minimum, int maximum) => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out int parsed) && parsed >= minimum && parsed <= maximum ? parsed : throw new ProtocolException(64, "A supervisor timeout bound is invalid.");
    private static string Sha256File(string path, int maximum) { byte[] bytes = ReadBounded(path, maximum, "file"); try { return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(); } finally { CryptographicOperations.ZeroMemory(bytes); } }
    private static string Sha256Stream(Stream stream) { stream.Position = 0; using var hash = SHA256.Create(); return Convert.ToHexString(hash.ComputeHash(stream)).ToLowerInvariant(); }
    private static string Sha256Text(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static bool FixedEquals(string left, string right) { if (!Digest.IsMatch(left) || !Digest.IsMatch(right)) return false; byte[] a = Convert.FromHexString(left), b = Convert.FromHexString(right); try { return CryptographicOperations.FixedTimeEquals(a, b); } finally { CryptographicOperations.ZeroMemory(a); CryptographicOperations.ZeroMemory(b); } }
    private static byte[] ReadBounded(string path, int maximum, string label) { var info = new FileInfo(path); if (!info.Exists || info.Length < 1 || info.Length > maximum || (info.Attributes & FileAttributes.ReparsePoint) != 0) throw new ProtocolException(65, $"The {label} is absent, unsafe, or oversized."); return File.ReadAllBytes(path); }
    private static void WriteStateNew(string path, State value) { if (File.Exists(path)) throw new ProtocolException(73, "The companion state already exists."); WriteAtomic(path, value, replace: false); }
    private static void WriteStateReplace(string path, State value) => WriteAtomic(path, value, replace: true);
    private static void WriteStartingIntentNew(string path, StartingIntent value) { if (File.Exists(path)) throw new ProtocolException(73, "The companion starting intent already exists."); WriteAtomic(path, value, replace: false); }
    private static void WriteAtomic<T>(string path, T value, bool replace) { Directory.CreateDirectory(Path.GetDirectoryName(path)!); string temp = path + "." + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture) + ".tmp"; byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions); try { using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough)) { stream.Write(bytes); stream.WriteByte((byte)'\n'); stream.Flush(true); } if (replace && File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path); } finally { CryptographicOperations.ZeroMemory(bytes); if (File.Exists(temp)) File.Delete(temp); } }
    private static void WriteReceipt(object value) => Console.Out.WriteLine(JsonSerializer.Serialize(value, JsonOptions));
    private static void Diagnostic(string value) => Console.Error.WriteLine(value.Replace('\r', ' ').Replace('\n', ' '));
    private static ProtocolException LastError(int code, string message) => new(code, message + " Win32=" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
    private static JsonElement ExactObject(JsonElement value, IEnumerable<string> keys, string label) { string[] expected = keys.OrderBy(item => item, StringComparer.Ordinal).ToArray(); if (value.ValueKind != JsonValueKind.Object || !value.EnumerateObject().Select(item => item.Name).OrderBy(item => item, StringComparer.Ordinal).SequenceEqual(expected, StringComparer.Ordinal)) throw new ProtocolException(65, $"The {label} schema is invalid."); return value; }
    private static string Required(JsonElement value, string name, int maximum) { if (!value.TryGetProperty(name, out JsonElement property) || property.ValueKind != JsonValueKind.String) throw new ProtocolException(65, $"The {name} field is invalid."); string result = property.GetString() ?? string.Empty; if (result.Length < 1 || result.Length > maximum || result.IndexOf('\0') >= 0 || result.IndexOf('\r') >= 0 || result.IndexOf('\n') >= 0) throw new ProtocolException(65, $"The {name} field is invalid."); return result; }
    private static string RequiredDigest(JsonElement value, string name) { string result = Required(value, name, 64).ToLowerInvariant(); return Digest.IsMatch(result) ? result : throw new ProtocolException(65, $"The {name} digest is invalid."); }
    private static int RequiredInt(JsonElement value, string name, int minimum, int maximum) { if (!value.TryGetProperty(name, out JsonElement property) || property.ValueKind != JsonValueKind.Number || !property.TryGetInt32(out int result) || result < minimum || result > maximum) throw new ProtocolException(65, $"The {name} field is invalid."); return result; }
    private static IReadOnlyList<string> ReadStrings(JsonElement value) { if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is < 1 or > 3) throw new ProtocolException(65, "The companion argument list is invalid."); return value.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString() ?? string.Empty : throw new ProtocolException(65, "A companion argument is invalid.")).ToArray(); }
    private static IReadOnlyDictionary<string, string> ReadEnvironment(JsonElement value) { if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() > 12) throw new ProtocolException(65, "The companion environment is invalid."); var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); foreach (JsonProperty property in value.EnumerateObject()) { if (property.Name.Length is < 1 or > 64 || property.Name.IndexOfAny(new[] { '\0', '\r', '\n', '=' }) >= 0 || property.Value.ValueKind != JsonValueKind.String || !result.TryAdd(property.Name, property.Value.GetString() ?? string.Empty)) throw new ProtocolException(65, "The companion environment is invalid."); } return result; }

    private sealed record Request(string Schema, int Version, string SupervisorId, string BundleRoot, string BundleId, string HelperPath, string HelperSha256, string NodePath, string NodeSha256, string MainPath, string MainSha256, IReadOnlyList<string> Arguments, string WorkingDirectory, string StateRoot, string StdoutPath, string StderrPath, IReadOnlyDictionary<string, string> Environment, string ControlToken, string StatePath);
    private sealed record StartingIntent(string Schema, int Version, string SupervisorId, string RequestSha256, string HelperPath, string HelperSha256, int LaunchPid, string LaunchCreationFileTimeUtc, string StartedAt, string Status, string AuthenticationTag);
    private sealed record State(string Schema, int Version, string SupervisorId, string BundleRoot, string BundleId, string HelperPath, string HelperSha256, string RequestSha256, string ControlTokenSha256, string JobName, int SupervisorPid, int ChildPid, string SupervisorCreationFileTimeUtc, string ChildCreationFileTimeUtc, string StartedAt, string Status, int? ExitCode, int ActiveProcesses, string AuthenticationTag);
    private sealed class StartedProcess(SafeFileHandle process, SafeFileHandle thread, int id) : IDisposable { public SafeFileHandle ProcessHandle { get; } = process; public SafeFileHandle ThreadHandle { get; } = thread; public int ProcessId { get; } = id; public void Dispose() { ThreadHandle.Dispose(); ProcessHandle.Dispose(); } }
    private sealed class ProtocolException(int exitCode, string message) : Exception(message) { public int ExitCode { get; } = exitCode; }
    private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid { public SafeJobHandle() : base(true) { } protected override bool ReleaseHandle() => CloseHandle(handle); }
    [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low; public uint High; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JobObjectBasicLimitInformation { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct JobObjectExtendedLimitInformation { public JobObjectBasicLimitInformation BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct JobObjectBasicAccountingInformationNative { public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime; public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo { public int cb; public string? lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeJobHandle CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeJobHandle OpenJobObject(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeJobHandle job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(SafeJobHandle job, int informationClass, IntPtr information, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(SafeJobHandle job, SafeHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsProcessInJob(SafeHandle process, SafeJobHandle? job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(SafeHandle process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(SafeHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(SafeHandle process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeHandle thread);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfoEx startupInfo, out ProcessInformation processInformation);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
