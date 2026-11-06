using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class NativeRestrictedHostProof
{
    private sealed class DescendantQueryEvidence(int index, string kind)
    {
        public int sequence { get; } = index;
        public string role { get; } = kind;
        public string status { get; set; } = "reserved";
        public bool originalJobVerified { get; set; }
        public bool liveBirthVerified { get; set; }
        public bool pinnedImageVerified { get; set; }
        public bool processHandleClosedVerified { get; set; }
        public SelfQueryEvidence? query { get; set; }
    }
    private static readonly List<DescendantQueryEvidence> DescendantQueries = new();
    internal static object DescendantSelfQueryDiagnostic => DescendantQueries.ToArray();

    private static uint WaitForRegisteredDescendants(SafeFileHandle owner, uint ownerPid, SafeJobHandle job, string context, JsonElement binding, string user)
    {
        var elapsed = Stopwatch.StartNew();
        string helper = binding.GetProperty("helper").GetString() ?? "", helperSha = binding.GetProperty("serviceImageSha256").GetString() ?? "";
        string setup = Path.Combine(Path.GetDirectoryName(helper)!, "Switchyard.Setup.exe"), directory = Path.GetDirectoryName(context)!, nonce = binding.GetProperty("nonce").GetString() ?? "";
        FileStream Pin(string path)
        {
            Require(Path.IsPathFullyQualified(path) && Path.GetFullPath(path) == path && (File.GetAttributes(path) & (FileAttributes.Directory | FileAttributes.ReparsePoint)) == 0);
            var image = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (image.Length is <= 0 or > 134217728) { image.Dispose(); throw new InvalidDataException("The fixed CI image is unavailable."); }
            return image;
        }
        using var helperImage = Pin(helper); using var setupImage = Pin(setup);
        Require(Convert.ToHexString(SHA256.HashData(helperImage)).ToLowerInvariant() == helperSha);
        string setupSha = Convert.ToHexString(SHA256.HashData(setupImage)).ToLowerInvariant();
        var identities = new HashSet<(uint, long)>(); int next = 1;
        while (elapsed.ElapsedMilliseconds < 90000)
        {
            uint wait = WaitForSingleObject(owner, 10); if (wait != 258) return wait;
            string requestPath = Path.Combine(directory, "descendant-" + next + ".request");
            if (!File.Exists(requestPath)) continue;
            Phase = "descendant-query-request";
            var request = DescendantQueryProtocol.Read(ReadBounded(requestPath), nonce, next);
            Require(request.Pid != ownerPid && request.Pid != Environment.ProcessId);
            var evidence = new DescendantQueryEvidence(next, request.Role); DescendantQueries.Add(evidence);
            string observedBirth;
            // Existing creator rights only: never modify a process DACL or
            // grant access to this process object. The handle stays exact.
            using (var child = OpenDescendantProcess(0x1000, false, request.Pid))
            {
                try
                {
                    Phase = "descendant-query-job"; Native(!child.IsInvalid);
                    Native(IsProcessInJob(child, job, out bool member)); Require(member); evidence.originalJobVerified = true;
                    Phase = "descendant-query-birth";
                    Native(GetProcessTimes(child, out long created, out long exited, out _, out _)); Require(exited == 0 && identities.Add((request.Pid, created)));
                    observedBirth = DateTime.FromFileTimeUtc(created).Ticks.ToString(CultureInfo.InvariantCulture);
                    Require(request.Birth == null || request.Birth == observedBirth); evidence.liveBirthVerified = true;
                    Phase = "descendant-query-image";
                    var path = new StringBuilder(32768); uint size = checked((uint)path.Capacity);
                    Native(QueryFullProcessImageNameW(child, 0, path, ref size)); Require(size > 0 && size < path.Capacity);
                    bool helperMatch = string.Equals(path.ToString(), helper, StringComparison.OrdinalIgnoreCase) && request.ExecutableSha256 == helperSha;
                    bool setupMatch = request.Role == "worker" && string.Equals(path.ToString(), setup, StringComparison.OrdinalIgnoreCase) && request.ExecutableSha256 == setupSha;
                    Require(helperMatch || setupMatch); evidence.pinnedImageVerified = true;
                    Phase = "descendant-query-exact-allowance";
                    ApplyOwnTokenQuery(child, user, "descendant-" + request.Role, query => evidence.query = query);
                    Native(GetProcessTimes(child, out long currentBirth, out exited, out _, out _)); Require(currentBirth == created && exited == 0 && WaitForSingleObject(owner, 0) == 258);
                    Native(IsProcessInJob(child, job, out member)); Require(member); evidence.status = "verified";
                }
                finally { child.Dispose(); evidence.processHandleClosedVerified = child.IsClosed; }
            }
            Require(evidence.status == "verified" && evidence.processHandleClosedVerified);
            var reply = new { schema = DescendantQueryProtocol.Schema, nonce, sequence = next, role = request.Role, pid = request.Pid, birth = observedBirth, executableSha256 = request.ExecutableSha256, status = "verified", grantedMask = 8 };
            string pending = Path.Combine(directory, "descendant-" + next + ".reply-pending"), complete = Path.Combine(directory, "descendant-" + next + ".reply");
            using (var file = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { JsonSerializer.Serialize(file, reply); file.Flush(true); }
            File.Move(pending, complete, false); next++; Phase = "bounded-owner-journey";
        }
        return 258;
    }
    [DllImport("kernel32.dll", EntryPoint = "OpenProcess", SetLastError = true)] private static extern SafeFileHandle OpenDescendantProcess(uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryFullProcessImageNameW(SafeFileHandle process, uint flags, StringBuilder image, ref uint length);
}
