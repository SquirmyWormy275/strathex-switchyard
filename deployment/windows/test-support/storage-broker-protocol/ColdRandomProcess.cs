using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class NativeRestrictedHostProof
{
    internal static object? ColdRandomDiagnostic;
    private static object CaptureColdRandom(string executable, string expectedHash, string resultPath, string repository, string desktop, IntPtr environment, SafeAccessTokenHandle source, SafeAccessTokenHandle restricted, string user, (bool Assigned, bool Enabled) quota)
    {
        Require(Path.IsPathFullyQualified(executable) && Path.GetFileName(executable) == "Switchyard.ColdRandom.exe" && expectedHash.Length == 64 && expectedHash.All(c => char.IsAsciiHexDigit(c) && !char.IsUpper(c)) && !File.Exists(resultPath));
        Require((File.GetAttributes(executable) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0);
        using var image = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        Require(image.Length is > 0 and <= 1048576 && Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant() == expectedHash);
        using var pipes = new RestrictedChildPipes();
        using var job = CreateJobObjectW(IntPtr.Zero, null); Native(!job.IsInvalid);
        var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
        Native(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()));
        IntPtr attributes = IntPtr.Zero, jobs = IntPtr.Zero; bool initialized = false;
        SafeFileHandle? child = null, thread = null; SafeAccessTokenHandle? token = null;
        uint wait = 0xffffffff; uint? code = null; ColdRandomReport.Evidence? report = null; bool validReport = false;
        RestrictedChildPipes.Evidence? stdio = null;
        try
        {
            IntPtr size = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size); Require(size.ToInt64() is > 0 and <= 65536);
            attributes = Marshal.AllocHGlobal(size); Native(InitializeProcThreadAttributeList(attributes, 2, 0, ref size)); initialized = true;
            jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
            Native(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            pipes.Bind(attributes);
            var startup = new StartupInfoEx { Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Desktop = desktop, Flags = 0x100, Input = pipes.Input, Output = pipes.Output, Error = pipes.Error }, Attributes = attributes };
            string command = Quote(executable) + " " + Quote(resultPath); Require(command.Length < 1024 && quota.Assigned);
            try
            {
                if (!quota.Enabled) SetQuotaPrivilege(source, true);
                Native(CreateProcessAsUserW(restricted, executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x8 | 0x80000 | 0x400, environment, repository, ref startup, out var process));
                child = new SafeFileHandle(process.Process, true); thread = new SafeFileHandle(process.Thread, true);
            }
            finally
            {
                if (!quota.Enabled) SetQuotaPrivilege(source, false);
                Require(PrivilegeState(source, "SeIncreaseQuotaPrivilege") == quota);
            }
            pipes.ChildStarted(); Native(IsProcessInJob(child, job, out bool member)); Require(member);
            Native(OpenProcessToken(child.DangerousGetHandle(), 8, out token)); VerifyToken(token, user, recordHistory: false);
            PermitOwnTokenQuery(child, user, "cold-probe");
            CaptureTokenObjectSecurity(child, user, "cold-probe");
            Native(ResumeThread(thread) != uint.MaxValue);
            wait = WaitForSingleObject(child, 10000); Require(wait is 0 or 258);
            if (wait == 0)
            {
                Native(GetExitCodeProcess(child, out uint exited)); code = exited;
                // A diagnostic failure does not substitute for the Node journey.
                // Its finite statuses survive; no result bytes or path are exported.
                if (code == 0 && File.Exists(resultPath))
                {
                    try { report = ColdRandomReport.Parse(ReadBounded(resultPath)); validReport = true; }
                    catch (InvalidOperationException) { }
                }
            }
        }
        finally
        {
            try
            {
                if (child != null)
                {
                    Native(TerminateJobObject(job, 124)); Require(WaitForSingleObject(child, 3000) == 0);
                    var clock = Stopwatch.StartNew(); while (ActiveProcesses(job) != 0 && clock.ElapsedMilliseconds < 3000) Thread.Sleep(10);
                    Require(ActiveProcesses(job) == 0);
                    if (token != null) VerifyToken(token, user, recordHistory: false);
                }
                stdio = pipes.Complete(); Require(stdio.outputBounded);
            }
            finally
            {
                token?.Dispose(); thread?.Dispose(); child?.Dispose();
                if (initialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs);
            }
        }
        Require(child != null && token != null && child.IsClosed && thread!.IsClosed && token.IsClosed);
        if (validReport && report != null)
        {
            var access = report.selfTokenAccess;
            SelfTokenQueryAccessVerified = access.query.opened && access.query.error == 0 && access.query.closeError == 0
                && !access.queryDuplicate.opened && access.queryDuplicate.error == 5
                && !access.queryDuplicateImpersonate.opened && access.queryDuplicateImpersonate.error == 5;
        }
        return new { schema = "switchyard-cold-restricted-random/v4", executableSha256 = expectedHash, waitResult = wait, exitCode = code, reportValid = validReport, report, primaryTokenVerified = true, tokenRecheckedAfterExit = true, treeExitVerified = true, processHandlesClosedVerified = true, creatorQuotaRestoredVerified = true, standardIo = stdio, nodeStartupAccepted = false };
    }
}
