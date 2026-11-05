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
    internal static object? CreatorPrivileges;
    internal static object? TokenReadDiagnostic;
    internal static object? ChildExitDiagnostic;
    private static readonly List<bool> HistoricalFilteredFlags = new();
    private static readonly List<uint> HistoricalFilterBytes = new();
    internal static bool[] HistoricalFilterObservations => HistoricalFilteredFlags.ToArray();
    internal static uint[] HistoricalFilterWidths => HistoricalFilterBytes.ToArray();
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
        bool probed = GetTokenInformation(token, kind, IntPtr.Zero, 0, out uint size);
        int probeError = probed ? 0 : Marshal.GetLastWin32Error();
        TokenReadDiagnostic = new { informationClass = kind, stage = "size-probe", succeeded = probed, nativeCode = probeError, bytes = size };
        if (!probed && probeError != 122) throw new Win32Exception(probeError);
        Require(!probed && size is >= 4 and <= 65536);
        var buffer = Marshal.AllocHGlobal(checked((int)size));
        try
        {
            bool read = GetTokenInformation(token, kind, buffer, size, out uint used); int readError = read ? 0 : Marshal.GetLastWin32Error();
            TokenReadDiagnostic = new { informationClass = kind, stage = "read", succeeded = read, nativeCode = readError, bytes = used };
            if (!read) throw new Win32Exception(readError);
            Require(used is >= 4 && used <= size); return buffer;
        }
        catch { Marshal.FreeHGlobal(buffer); throw; }
    }
    private static T ReadToken<T>(SafeAccessTokenHandle token, int kind, Func<IntPtr,T> read)
    {
        IntPtr buffer = TokenInformation(token, kind); try { return read(buffer); } finally { Marshal.FreeHGlobal(buffer); }
    }
    private static bool ReadHistoricalFilter(SafeAccessTokenHandle token)
    {
        // Native Windows can return this historical BOOLEAN as one byte. Do not
        // read a DWORD beyond that buffer or relax any other token decoder.
        const int kind = 21;
        bool probed = GetTokenInformation(token, kind, IntPtr.Zero, 0, out uint size);
        int probeError = probed ? 0 : Marshal.GetLastWin32Error();
        TokenReadDiagnostic = new { informationClass = kind, stage = "size-probe", succeeded = probed, nativeCode = probeError, bytes = size };
        if (!probed && probeError != 122) throw new Win32Exception(probeError);
        Require(!probed && size is 1 or 4);
        var buffer = Marshal.AllocHGlobal(checked((int)size));
        try
        {
            bool read = GetTokenInformation(token, kind, buffer, size, out uint used); int readError = read ? 0 : Marshal.GetLastWin32Error();
            TokenReadDiagnostic = new { informationClass = kind, stage = "read", succeeded = read, nativeCode = readError, bytes = used };
            if (!read) throw new Win32Exception(readError);
            Require(used == size);
            bool value = size == 1 ? Marshal.ReadByte(buffer) != 0 : Marshal.ReadInt32(buffer) != 0;
            HistoricalFilterBytes.Add(used); return value;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    private static string User(SafeAccessTokenHandle token) => ReadToken(token, 1, pointer => new SecurityIdentifier(Marshal.ReadIntPtr(pointer)).Value);
    private static (bool Assigned, bool Enabled) PrivilegeState(SafeAccessTokenHandle token, string name)
    {
        Native(LookupPrivilegeValueW(null, name, out long expected));
        return ReadToken(token, 3, pointer =>
        {
            int count = Marshal.ReadInt32(pointer); Require(count is >= 0 and <= 256);
            for (int i = 0; i < count; i++)
            {
                var privilege = Marshal.PtrToStructure<Privilege>(IntPtr.Add(pointer, 4 + i * Marshal.SizeOf<Privilege>()));
                if (privilege.Low == unchecked((uint)expected) && privilege.High == unchecked((int)(expected >> 32))) return ((privilege.Attributes & 4) == 0, (privilege.Attributes & 2) != 0);
            }
            return (false, false);
        });
    }
    private static void VerifyToken(SafeAccessTokenHandle token, string user)
    {
        string stage = Phase;
        Phase = stage + "/same-user";
        Require(User(token) == user);
        Phase = stage + "/primary-kind";
        Require(ReadToken(token, 8, pointer => Marshal.ReadInt32(pointer)) == 1); // TokenPrimary
        Phase = stage + "/medium-integrity";
        Require(ReadToken(token, 25, pointer => new SecurityIdentifier(Marshal.ReadIntPtr(pointer)).Value) == "S-1-16-8192");
        Phase = stage + "/restricting-sids-present";
        Require(IsTokenRestricted(token));
        // Historical filter metadata is not the actual restricting SID list.
        // Observe it without substituting it for the public restriction proof.
        Phase = stage + "/historical-filter-observation";
        HistoricalFilteredFlags.Add(ReadHistoricalFilter(token));
        Phase = stage + "/restricting-sid-count";
        var restrictions = ReadToken(token, 11, pointer =>
        {
            int count = Marshal.ReadInt32(pointer); Require(count == 4); var result = new HashSet<string>(StringComparer.Ordinal);
            for (int i = 0; i < count; i++) result.Add(new SecurityIdentifier(Marshal.PtrToStructure<SidAttributes>(IntPtr.Add(pointer, (IntPtr.Size == 8 ? 8 : 4) + i * Marshal.SizeOf<SidAttributes>())).Sid).Value);
            return result;
        });
        Phase = stage + "/restricting-sid-identities";
        Require(restrictions.SetEquals(new[] { user, "S-1-1-0", "S-1-5-11", "S-1-5-32-545" }));
        Phase = stage + "/administrators-deny-only";
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
        Phase = stage + "/assigned-privileges";
        Native(LookupPrivilegeValueW(null, "SeManageVolumePrivilege", out long volume));
        Native(LookupPrivilegeValueW(null, "SeChangeNotifyPrivilege", out long traverse));
        ReadToken(token, 3, pointer =>
        {
            int count = Marshal.ReadInt32(pointer); Require(count is >= 0 and <= 1);
            for (int i = 0; i < count; i++) { var privilege = Marshal.PtrToStructure<Privilege>(IntPtr.Add(pointer, 4 + i * Marshal.SizeOf<Privilege>())); Require(privilege.Low != unchecked((uint)volume) || privilege.High != unchecked((int)(volume >> 32))); Require(privilege.Low == unchecked((uint)traverse) && privilege.High == unchecked((int)(traverse >> 32))); }
            return true;
        });
        Phase = stage;
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
        Native(OpenProcessToken(new IntPtr(-1), 0xab, out var source));
        using (source)
        {
            var quota = PrivilegeState(source, "SeIncreaseQuotaPrivilege");
            var assign = PrivilegeState(source, "SeAssignPrimaryTokenPrivilege");
            var impersonate = PrivilegeState(source, "SeImpersonatePrivilege");
            CreatorPrivileges = new { quotaAssigned = quota.Assigned, quotaEnabled = quota.Enabled, assignPrimaryAssigned = assign.Assigned, assignPrimaryEnabled = assign.Enabled, impersonateAssigned = impersonate.Assigned, impersonateEnabled = impersonate.Enabled };
            string user = User(source);
            Phase = "private-user-object-space";
            using var desktopSpace = new PrivateDesktopSpace(user);
            IntPtr admin = IntPtr.Zero, medium = IntPtr.Zero, deleted = IntPtr.Zero, restricting = IntPtr.Zero;
            var restrictingSids = new List<IntPtr>();
            try
            {
                Phase = "restricted-primary-token";
                Native(ConvertStringSidToSidW("S-1-5-32-544", out admin)); var disabled = new SidAttributes { Sid = admin };
                // Create explicit SID restrictions and privilege deletion in
                // one public API call, then verify the actual resulting token.
                restricting = Marshal.AllocHGlobal(Marshal.SizeOf<SidAttributes>() * 4);
                foreach (string text in new[] { user, "S-1-1-0", "S-1-5-11", "S-1-5-32-545" })
                {
                    Native(ConvertStringSidToSidW(text, out var sid)); restrictingSids.Add(sid);
                    Marshal.StructureToPtr(new SidAttributes { Sid = sid }, IntPtr.Add(restricting, (restrictingSids.Count - 1) * Marshal.SizeOf<SidAttributes>()), false);
                }
                {
                    // Explicitly delete every assigned privilege except normal
                    // traverse notification in one filter. No disabled powerful
                    // privilege remains available for the child to re-enable.
                    Native(LookupPrivilegeValueW(null, "SeChangeNotifyPrivilege", out long traverse));
                    var removals = ReadToken(source, 3, pointer =>
                    {
                        int count = Marshal.ReadInt32(pointer); Require(count is >= 0 and <= 256); var result = new List<Privilege>();
                        for (int i = 0; i < count; i++)
                        {
                            var privilege = Marshal.PtrToStructure<Privilege>(IntPtr.Add(pointer, 4 + i * Marshal.SizeOf<Privilege>()));
                            if (privilege.Low != unchecked((uint)traverse) || privilege.High != unchecked((int)(traverse >> 32))) result.Add(new Privilege { Low = privilege.Low, High = privilege.High });
                        }
                        return result;
                    });
                    if (removals.Count > 0)
                    {
                        deleted = Marshal.AllocHGlobal(Marshal.SizeOf<Privilege>() * removals.Count);
                        for (int i = 0; i < removals.Count; i++) Marshal.StructureToPtr(removals[i], IntPtr.Add(deleted, i * Marshal.SizeOf<Privilege>()), false);
                    }
                    Native(CreateRestrictedToken(source, 0, 1, ref disabled, checked((uint)removals.Count), deleted, 4, restricting, out var restricted));
                    using (restricted)
                    {
                        Native(ConvertStringSidToSidW("S-1-16-8192", out medium)); var label = new SidAttributes { Sid = medium, Attributes = 0x20 };
                        Native(SetTokenInformation(restricted, 25, ref label, checked((uint)Marshal.SizeOf<SidAttributes>() + GetLengthSid(medium))));
                        VerifyToken(restricted, user);
                        Phase = "owned-job-before-process";
                        using var job = CreateJobObjectW(IntPtr.Zero, null); Native(!job.IsInvalid);
                        var limits = new ExtendedLimits { Basic = new BasicLimits { Flags = 0x2000 } };
                        Native(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>()));
                        IntPtr attributes = IntPtr.Zero, jobs = IntPtr.Zero, environment = IntPtr.Zero; bool initialized = false;
                        try
                        {
                            IntPtr size = IntPtr.Zero; _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size); Require(size.ToInt64() is > 0 and <= 65536);
                            attributes = Marshal.AllocHGlobal(size); Native(InitializeProcThreadAttributeList(attributes, 1, 0, ref size)); initialized = true;
                            jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, job.DangerousGetHandle());
                            Native(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                            var startup = new StartupInfoEx { Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Desktop = desktopSpace.Name }, Attributes = attributes };
                            var variables = new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                            // The outer guardian supplies this bounded allowlisted
                            // environment; creation receives it explicitly.
                            foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
                            {
                                string name = (string)entry.Key, text = (string)entry.Value!;
                                Require(name.Length is > 0 and <= 128 && name.IndexOfAny(new[] { '\0', '=' }) < 0 && text.Length <= 8192 && !text.Contains('\0'));
                                variables.Add(name, text);
                            }
                            Require(variables.Count is > 0 and <= 64);
                            environment = Marshal.StringToHGlobalUni(string.Join('\0', variables.Select(entry => entry.Key + "=" + entry.Value)) + "\0\0");
                            string command = string.Join(' ', new[] { node, script, context }.Select(Quote)); Require(command.Length < 1024);
                            Phase = "creator-assigned-quota-privilege"; Require(quota.Assigned);
                            ProcessInformation process = default;
                            try
                            {
                                if (!quota.Enabled) SetQuotaPrivilege(source, true);
                                Phase = "create-restricted-child-with-explicit-restrictions";
                                // Direct creation accepts the creation-time Job
                                // attribute. No secondary-logon fallback, profile
                                // load, new account or post-creation job gap.
                                Native(CreateProcessAsUserW(restricted, node, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, false, 0x4 | 0x8000000 | 0x80000 | 0x400, environment, repository, ref startup, out process));
                            }
                            finally
                            {
                                try
                                {
                                    if (!quota.Enabled) SetQuotaPrivilege(source, false);
                                    Require(PrivilegeState(source, "SeIncreaseQuotaPrivilege") == quota);
                                }
                                catch { if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread); if (process.Process != IntPtr.Zero) CloseHandle(process.Process); throw; }
                            }
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
                                    uint wait = WaitForSingleObject(child, 90000);
                                    ChildExitDiagnostic = new { waitResult = wait, resultAvailable = File.Exists(resultPath) };
                                    Require(wait == 0); Native(GetExitCodeProcess(child, out uint code));
                                    ChildExitDiagnostic = new { waitResult = wait, exitCode = code, resultAvailable = File.Exists(resultPath) };
                                    // A failing owned child can report its bounded phase before
                                    // the strict exit assertion. Never emit its private paths.
                                    if (File.Exists(resultPath))
                                    {
                                        using var diagnostic = JsonDocument.Parse(ReadBounded(resultPath)); var diagnosticReport = diagnostic.RootElement;
                                        Require(diagnosticReport.GetProperty("schema").GetString() == "switchyard-restricted-host-result/v1" && diagnosticReport.GetProperty("nonce").GetString() == nonce);
                                        var diagnosticOwner = diagnosticReport.GetProperty("owner");
                                        string? SafeLabel(string name) => diagnosticOwner.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.String && item.GetString() is string text && text.Length is > 0 and <= 80 && text.All(c => char.IsAsciiLetterOrDigit(c) || c == '-') ? text : null;
                                        ChildExitDiagnostic = new { waitResult = wait, exitCode = code, resultAvailable = true, childReportedSuccess = diagnosticReport.GetProperty("success").GetBoolean(), ownerReportedSuccess = diagnosticOwner.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.True, completedChecks = diagnosticOwner.TryGetProperty("checks", out var checks) && checks.ValueKind == JsonValueKind.Array ? checks.GetArrayLength() : 0, failedPhase = SafeLabel("failedPhase"), failureCategory = SafeLabel("failureCategory") };
                                    }
                                    Require(code == 0);
                                    VerifyToken(childToken, user);
                                }
                                Phase = "independent-owned-tree-exit";
                                Require(ActiveProcesses(job) == 0);
                                using var result = JsonDocument.Parse(ReadBounded(resultPath)); var report = result.RootElement;
                                Require(report.GetProperty("schema").GetString() == "switchyard-restricted-host-result/v1" && report.GetProperty("nonce").GetString() == nonce && report.GetProperty("success").GetBoolean());
                                var owner = report.GetProperty("owner"); Require(owner.GetProperty("success").GetBoolean() && owner.GetProperty("checks").GetArrayLength() == 8 && owner.GetProperty("nativeExitVerified").GetBoolean() && owner.GetProperty("fixtureRemoved").GetBoolean() && !owner.GetProperty("ordinaryUserToken").GetBoolean());
                                Phase = "complete";
                                return new { schema = "switchyard-restricted-host-process-proof/v1", success = true, processCreationApi = "CreateProcessAsUserW", startupDesktop = "owned-noninteractive", interactiveDesktopInherited = false, privateDesktopClosedVerified = true, creatorPrivileges = CreatorPrivileges, creatorQuotaRestoredVerified = true, restrictingSidListVerified = true, restrictingSidCount = 4, primaryTokenVerified = true, sameUserVerified = true, mediumIntegrityVerified = true, administratorsDenyOnlyVerified = true, volumePrivilegeAbsentVerified = true, onlyTraversePrivilegeAssignedVerified = true, historicalFilteredFlags = HistoricalFilteredFlags.ToArray(), historicalFilterBytes = HistoricalFilterBytes.ToArray(), tokenRecheckedAfterExit = true, treeExitVerified = true, hostOwnerChecks = 8, hostOwner = owner.Clone(), ordinaryUserAccountAccepted = false, guestLaunched = false, accountCreated = false };
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
                        finally { if (initialized) DeleteProcThreadAttributeList(attributes); if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs); if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment); }
                    }
                }
            }
            finally { if (admin != IntPtr.Zero) LocalFree(admin); if (medium != IntPtr.Zero) LocalFree(medium); if (deleted != IntPtr.Zero) Marshal.FreeHGlobal(deleted); if (restricting != IntPtr.Zero) Marshal.FreeHGlobal(restricting); foreach (IntPtr sid in restrictingSids) LocalFree(sid); }
        }
    }
    private static void SetQuotaPrivilege(SafeAccessTokenHandle token, bool enabled)
    {
        Native(LookupPrivilegeValueW(null, "SeIncreaseQuotaPrivilege", out long luid));
        var state = new TokenPrivileges { Count = 1, Entry = new Privilege { Low = unchecked((uint)luid), High = unchecked((int)(luid >> 32)), Attributes = enabled ? 2u : 0u } };
        Native(AdjustTokenPrivileges(token, false, ref state, 0, IntPtr.Zero, IntPtr.Zero));
        int error = Marshal.GetLastWin32Error(); if (error != 0) throw new Win32Exception(error);
        Require(PrivilegeState(token, "SeIncreaseQuotaPrivilege") == (true, enabled));
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
    [StructLayout(LayoutKind.Sequential)] private struct TokenPrivileges { public uint Count; public Privilege Entry; }
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
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsTokenRestricted(SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AdjustTokenPrivileges(SafeAccessTokenHandle token, bool disableAll, ref TokenPrivileges state, uint length, IntPtr previous, IntPtr returned);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetTokenInformation(SafeAccessTokenHandle token, int kind, ref SidAttributes label, uint size);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateRestrictedToken(SafeAccessTokenHandle source, uint flags, uint count, ref SidAttributes disabled, uint deleteCount, IntPtr deleted, uint restrictCount, IntPtr restricting, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSidToSidW(string value, out IntPtr sid);
    [DllImport("advapi32.dll")] private static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValueW(string? system, string name, out long luid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessAsUserW(SafeAccessTokenHandle token, string image, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
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
