using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

// Test assembly only. Never linked into the shipped helper or setup executable.
// Thread impersonation does not establish a child's primary token: use the
// explicit restricted-token creation API, then inspect the actual child token.
[SupportedOSPlatform("windows")]
internal static class NativeRestrictedHostProof
{
    internal static string Phase = "not-started";
    private static void Require(bool condition) { if (!condition) throw new InvalidOperationException("The restricted host process proof did not verify."); }
    private static void Native(bool condition) { if (!condition) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    private static byte[] ReadBounded(string path)
    {
        Require((File.GetAttributes(path) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0);
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        Require(file.Length is > 1 and <= 16384); var bytes = new byte[checked((int)file.Length)]; file.ReadExactly(bytes); Require(file.ReadByte() == -1); return bytes;
    }
    private static IntPtr TokenInformation(SafeAccessTokenHandle token, int kind)
    {
        _ = GetTokenInformation(token, kind, IntPtr.Zero, 0, out uint size);
        Require(Marshal.GetLastWin32Error() == 122 && size is >= 4 and <= 65536);
        var buffer = Marshal.AllocHGlobal(checked((int)size));
        try { Native(GetTokenInformation(token, kind, buffer, size, out uint used)); Require(used <= size); return buffer; }
        catch { Marshal.FreeHGlobal(buffer); throw; }
    }
    private static T ReadToken<T>(SafeAccessTokenHandle token, int kind, Func<IntPtr,T> read)
    {
        IntPtr buffer = TokenInformation(token, kind); try { return read(buffer); } finally { Marshal.FreeHGlobal(buffer); }
    }
    private static string User(SafeAccessTokenHandle token) => ReadToken(token, 1, pointer => new SecurityIdentifier(Marshal.ReadIntPtr(pointer)).Value);
    private static void VerifyToken(SafeAccessTokenHandle token, string user)
    {
        Require(User(token) == user);
        Require(ReadToken(token, 8, pointer => Marshal.ReadInt32(pointer)) == 1); // TokenPrimary
        Require(ReadToken(token, 25, pointer => new SecurityIdentifier(Marshal.ReadIntPtr(pointer)).Value) == "S-1-16-8192");
        bool disabledAdmin = ReadToken(token, 2, pointer =>
        {
            int count = Marshal.ReadInt32(pointer); Require(count is >= 1 and <= 1024);
            int offset = IntPtr.Size == 8 ? 8 : 4, stride = Marshal.SizeOf<SidAttributes>(); bool found = false;
            for (int i = 0; i < count; i++)
            {
                var group = Marshal.PtrToStructure<SidAttributes>(IntPtr.Add(pointer, offset + i * stride));
                if (new SecurityIdentifier(group.Sid).Value == "S-1-5-32-544") { Require(!found); found = true; Require((group.Attributes & 0x10) != 0 && (group.Attributes & 4) == 0); }
            }
            return found;
        });
        Require(disabledAdmin);
        Native(LookupPrivilegeValueW(null, "SeManageVolumePrivilege", out long volume));
        ReadToken(token, 3, pointer =>
        {
            int count = Marshal.ReadInt32(pointer); Require(count is >= 0 and <= 256);
            for (int i = 0; i < count; i++) { var privilege = Marshal.PtrToStructure<Privilege>(IntPtr.Add(pointer, 4 + i * Marshal.SizeOf<Privilege>())); Require(privilege.Low != unchecked((uint)volume) || privilege.High != unchecked((int)(volume >> 32))); }
            return true;
        });
    }
    internal static object Run()
    {
        Require(Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true" && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows");
        Phase = "fixed-context";
        string context = Environment.GetEnvironmentVariable("SWITCHYARD_TEST_RESTRICTED_HOST_CONTEXT") ?? "", repository = Environment.GetEnvironmentVariable("GITHUB_WORKSPACE") ?? "";
        Require(Path.IsPathFullyQualified(context) && Path.IsPathFullyQualified(repository));
        using var document = JsonDocument.Parse(ReadBounded(context)); var value = document.RootElement;
        Require(value.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(new[] { "helper", "installationId", "node", "nodeSha256", "nonce", "schema", "serviceImageSha256" }));
        Require(value.GetProperty("schema").GetString() == "switchyard-restricted-host-context/v1");
        string node = value.GetProperty("node").GetString() ?? "", digest = value.GetProperty("nodeSha256").GetString() ?? "", nonce = value.GetProperty("nonce").GetString() ?? "";
        Require(Path.IsPathFullyQualified(node) && Path.GetFileName(node).Equals("node.exe", StringComparison.OrdinalIgnoreCase) && digest.Length == 64 && digest.All(c => char.IsAsciiHexDigit(c) && !char.IsUpper(c)) && Guid.TryParseExact(nonce, "N", out _));
        Require(value.GetProperty("installationId").GetString() == Environment.GetEnvironmentVariable("SWITCHYARD_TEST_BROKER_INSTALLATION_ID"));
        string script = Path.Combine(repository, "scripts", "windows-broker-restricted-owner.mjs"), resultPath = Path.Combine(Path.GetDirectoryName(context)!, "result.json");
        Require(!File.Exists(resultPath));
        using var image = new FileStream(node, FileMode.Open, FileAccess.Read, FileShare.Read);
        Require((File.GetAttributes(node) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0 && image.Length is > 0 and <= 134217728);
        Require(Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant() == digest);
        Require((File.GetAttributes(script) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0);
        Native(OpenProcessToken(new IntPtr(-1), 0x8b, out var source));
        using (source)
        {
            string user = User(source); IntPtr admin = IntPtr.Zero, medium = IntPtr.Zero, deleted = IntPtr.Zero;
            try
            {
                Phase = "restricted-primary-token";
                Native(ConvertStringSidToSidW("S-1-5-32-544", out admin)); var disabled = new SidAttributes { Sid = admin };
                Native(CreateRestrictedToken(source, 1, 1, ref disabled, 0, IntPtr.Zero, 0, IntPtr.Zero, out var reduced));
                using (reduced)
                {
                    // DISABLE_MAX_PRIVILEGE ignores its delete list. Delete the
                    // volume privilege in a second call, then verify absence.
                    Native(LookupPrivilegeValueW(null, "SeManageVolumePrivilege", out long volume)); deleted = Marshal.AllocHGlobal(Marshal.SizeOf<Privilege>());
                    Marshal.StructureToPtr(new Privilege { Low = unchecked((uint)volume), High = unchecked((int)(volume >> 32)) }, deleted, false);
                    Native(CreateRestrictedToken(reduced, 0, 0, ref disabled, 1, deleted, 0, IntPtr.Zero, out var restricted));
                    using (restricted)
                    {
                        Native(ConvertStringSidToSidW("S-1-16-8192", out medium)); var label = new SidAttributes { Sid = medium, Attributes = 0x20 };
                        Native(SetTokenInformation(restricted, 25, ref label, checked((uint)Marshal.SizeOf<SidAttributes>() + GetLengthSid(medium))));
                        VerifyToken(restricted, user);
                        Phase = "owned-job-before-process";
                        using var job = CreateJobObjectW(IntPtr.Zero, null); Native(!job.IsInvalid);
                        var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
                        Native(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()));
                        IntPtr attributes = IntPtr.Zero, jobs = IntPtr.Zero; bool initialized = false;
                        try
                        {
                            IntPtr size = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); Require(size.ToInt64() is > 0 and <= 65536);
                            attributes = Marshal.AllocHGlobal(size); Native(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); initialized = true;
                            jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
                            Native(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                            var startup = new StartupInfoEx { Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>() }, Attributes = attributes };
                            Phase = "create-restricted-child";
                            Native(CreateProcessAsUserW(restricted, node, new StringBuilder(string.Join(' ', new[] { node, script, context }.Select(Quote))), IntPtr.Zero, IntPtr.Zero, false, 0x4 | 0x8000000 | 0x80000, IntPtr.Zero, repository, ref startup, out var process));
                            using var child = new SafeFileHandle(process.Process, true); using var thread = new SafeFileHandle(process.Thread, true);
                            try
                            {
                                Phase = "actual-child-token-before-start";
                                Native(IsProcessInJob(child, job, out bool member)); Require(member);
                                Native(OpenProcessToken(child.DangerousGetHandle(), 8, out var childToken));
                                using (childToken)
                                {
                                    VerifyToken(childToken, user);
                                    Native(ResumeThread(thread) != uint.MaxValue);
                                    Phase = "bounded-owner-journey";
                                    Require(WaitForSingleObject(child, 90000) == 0); Native(GetExitCodeProcess(child, out uint code)); Require(code == 0);
                                    VerifyToken(childToken, user);
                                }
                                Phase = "independent-owned-tree-exit";
                                Require(ActiveProcesses(job) == 0);
                                using var result = JsonDocument.Parse(ReadBounded(resultPath)); var report = result.RootElement;
                                Require(report.GetProperty("schema").GetString() == "switchyard-restricted-host-result/v1" && report.GetProperty("nonce").GetString() == nonce && report.GetProperty("success").GetBoolean());
                                var owner = report.GetProperty("owner"); Require(owner.GetProperty("success").GetBoolean() && owner.GetProperty("checks").GetArrayLength() == 8 && owner.GetProperty("nativeExitVerified").GetBoolean() && owner.GetProperty("fixtureRemoved").GetBoolean() && !owner.GetProperty("ordinaryUserToken").GetBoolean());
                                Phase = "complete";
                                return new { schema = "switchyard-restricted-host-process-proof/v1", success = true, primaryTokenVerified = true, sameUserVerified = true, mediumIntegrityVerified = true, administratorsDenyOnlyVerified = true, volumePrivilegeAbsentVerified = true, tokenRecheckedAfterExit = true, treeExitVerified = true, hostOwnerChecks = 8, hostOwner = owner.Clone(), ordinaryUserAccountAccepted = false, guestLaunched = false, accountCreated = false };
                            }
                            finally
                            {
                                // Exact owned job only; closing it also kills its
                                // tree if this proof is interrupted at any point.
                                Native(TerminateJobObject(job, 124));
                                Require(WaitForSingleObject(child, 3000) == 0);
                                var watch = Stopwatch.StartNew(); while (ActiveProcesses(job) != 0 && watch.ElapsedMilliseconds < 3000) Thread.Sleep(10);
                                Require(ActiveProcesses(job) == 0);
                            }
                        }
                        finally { if (initialized) DeleteProcThreadAttributeList(attributes); if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs); }
                    }
                }
            }
            finally { if (admin != IntPtr.Zero) LocalFree(admin); if (medium != IntPtr.Zero) LocalFree(medium); if (deleted != IntPtr.Zero) Marshal.FreeHGlobal(deleted); }
        }
    }
    private static uint ActiveProcesses(SafeJobHandle job) { Native(QueryInformationJobObject(job, 1, out var accounting, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero)); return accounting.Active; }
    private static string Quote(string value)
    {
        Require(value.IndexOfAny(new[] { '\0', '\r', '\n' }) < 0); var result = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) { if (c == '\\') { slashes++; continue; } result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes).Append(c); slashes = 0; }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct Privilege { public uint Low; public int High; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo { public int Size; public string? Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags; public ushort Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo Info; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr Minimum, Maximum; public uint Count; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadCount, WriteCount, OtherCount, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting { public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime; public uint Faults, Total, Active, Terminated; }
    private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid { private SafeJobHandle() : base(true) {} protected override bool ReleaseHandle() => CloseHandle(handle); }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int kind, IntPtr buffer, uint size, out uint used);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetTokenInformation(SafeAccessTokenHandle token, int kind, ref SidAttributes label, uint size);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateRestrictedToken(SafeAccessTokenHandle source, uint flags, uint count, ref SidAttributes disabled, uint deleteCount, IntPtr deleted, uint restrictCount, IntPtr restricting, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSidToSidW(string value, out IntPtr sid);
    [DllImport("advapi32.dll")] private static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValueW(string? system, string name, out long luid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessAsUserW(SafeAccessTokenHandle token, string image, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeJobHandle CreateJobObjectW(IntPtr security, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeJobHandle job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(SafeJobHandle job, int kind, out Accounting accounting, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(SafeJobHandle job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsProcessInJob(SafeFileHandle process, SafeJobHandle job, [MarshalAs(UnmanagedType.Bool)] out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle process, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributes, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr attributes, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributes);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
