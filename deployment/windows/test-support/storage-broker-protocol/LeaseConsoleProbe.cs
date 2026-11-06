using System.Diagnostics;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class NativeRestrictedHostProof
{
    private sealed class LeaseConsoleObservation(string creationMode, string imageHash)
    {
        public string schema { get; } = "switchyard-lease-console-probe/v2";
        public string imageSubsystem { get; } = "windows-gui";
        public string mode { get; } = creationMode;
        public string executableSha256 { get; } = imageHash;
        public string stage { get; set; } = "reserved";
        public uint? waitResult { get; set; }
        public uint? exitCode { get; set; }
        public bool entryObserved { get; set; }
        public bool primaryTokenVerified { get; set; }
        public bool tokenRecheckedAfterExit { get; set; }
        public bool treeExitVerified { get; set; }
        public bool processHandlesClosedVerified { get; set; }
        public bool creatorQuotaRestoredVerified { get; set; }
        public SelfQueryEvidence? queryAcl { get; set; }
        public RestrictedChildPipes.Evidence? standardIo { get; set; }
    }
    private static readonly List<LeaseConsoleObservation> LeaseConsoleObservations = new();
    internal static object LeaseConsoleDiagnostic => LeaseConsoleObservations.ToArray();

    // CI-only comparison. Both children enter the same creation-time Job and
    // exact restricted primary. EOF deliberately refuses before a lock request.
    // It does not change Node's production spawn mode or libuv job ownership.
    private static void ProbeLeaseConsoles(string executable, string expectedHash, string repository, string desktop, IntPtr environment, SafeAccessTokenHandle source, SafeAccessTokenHandle restricted, string user, (bool Assigned, bool Enabled) quota)
    {
        Require(LeaseConsoleObservations.Count == 0 && Path.IsPathFullyQualified(executable) && Path.GetFileName(executable) == "Switchyard.Hotkeys.exe");
        Require(expectedHash.Length == 64 && expectedHash.All(c => char.IsAsciiHexDigit(c) && !char.IsUpper(c)) && (File.GetAttributes(executable) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0);
        using var image = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        Require(image.Length is > 0 and <= 134217728 && Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant() == expectedHash);
        Phase = "lease-helper-image-subsystem";
        image.Position = 0;
        using (var pe = new PEReader(image, PEStreamOptions.LeaveOpen)) Require(pe.PEHeaders.PEHeader?.Subsystem == Subsystem.WindowsGui);
        foreach (string mode in new[] { "no-window", "detached" })
        {
            Phase = "lease-console-" + mode;
            var evidence = new LeaseConsoleObservation(mode, expectedHash); LeaseConsoleObservations.Add(evidence);
            using var pipes = new RestrictedChildPipes();
            using var job = CreateJobObjectW(IntPtr.Zero, null); Native(!job.IsInvalid);
            var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
            Native(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()));
            IntPtr attributes = IntPtr.Zero, jobs = IntPtr.Zero; bool initialized = false;
            SafeFileHandle? child = null, thread = null; SafeAccessTokenHandle? token = null;
            try
            {
                IntPtr size = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size); Require(size.ToInt64() is > 0 and <= 65536);
                attributes = Marshal.AllocHGlobal(size); Native(InitializeProcThreadAttributeList(attributes, 2, 0, ref size)); initialized = true;
                jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
                Native(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)); pipes.Bind(attributes);
                var startup = new StartupInfoEx { Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Desktop = desktop, Flags = 0x100, Input = pipes.Input, Output = pipes.Output, Error = pipes.Error }, Attributes = attributes };
                string command = Quote(executable) + " --state-lease-worker"; Require(command.Length < 1024 && quota.Assigned);
                try
                {
                    if (!quota.Enabled) SetQuotaPrivilege(source, true);
                    uint console = mode == "no-window" ? 0x08000000u : 0x8u;
                    Native(CreateProcessAsUserW(restricted, executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x4 | console | 0x80000 | 0x400, environment, repository, ref startup, out var process));
                    child = new SafeFileHandle(process.Process, true); thread = new SafeFileHandle(process.Thread, true); evidence.stage = "created-suspended";
                }
                finally
                {
                    if (!quota.Enabled) SetQuotaPrivilege(source, false);
                    Require(PrivilegeState(source, "SeIncreaseQuotaPrivilege") == quota); evidence.creatorQuotaRestoredVerified = true;
                }
                pipes.ChildStarted(); Native(IsProcessInJob(child, job, out bool member)); Require(member);
                Native(OpenProcessToken(child.DangerousGetHandle(), 8, out token)); VerifyToken(token, user, recordHistory: false); evidence.primaryTokenVerified = true; evidence.stage = "token-verified";
                ApplyOwnTokenQuery(child, user, "lease-" + mode, query => evidence.queryAcl = query); evidence.stage = "query-verified";
                Native(ResumeThread(thread) != uint.MaxValue); evidence.stage = "resumed";
                uint wait = WaitForSingleObject(child, 5000); evidence.waitResult = wait; Require(wait is 0 or 258);
                if (wait == 0) { Native(GetExitCodeProcess(child, out uint code)); evidence.exitCode = code; evidence.stage = "exited"; }
            }
            finally
            {
                try
                {
                    if (child != null)
                    {
                        Native(TerminateJobObject(job, 124)); Require(WaitForSingleObject(child, 3000) == 0);
                        var clock = Stopwatch.StartNew(); while (ActiveProcesses(job) != 0 && clock.ElapsedMilliseconds < 3000) Thread.Sleep(10);
                        Require(ActiveProcesses(job) == 0); evidence.treeExitVerified = true;
                        if (token != null) { VerifyToken(token, user, recordHistory: false); evidence.tokenRecheckedAfterExit = true; }
                    }
                    evidence.standardIo = pipes.Complete(); Require(evidence.standardIo.outputBounded); evidence.entryObserved = pipes.LeaseEntryObserved;
                }
                finally
                {
                    token?.Dispose(); thread?.Dispose(); child?.Dispose(); evidence.processHandlesClosedVerified = child != null && child.IsClosed && thread != null && thread.IsClosed && token != null && token.IsClosed;
                    if (initialized) DeleteProcThreadAttributeList(attributes);
                    if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                    if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs);
                }
            }
            Require(evidence.treeExitVerified && evidence.processHandlesClosedVerified && evidence.tokenRecheckedAfterExit); evidence.stage = "retired";
        }
    }
}
