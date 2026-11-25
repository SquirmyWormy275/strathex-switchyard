using System.Security.Cryptography;
using System.Text.Json;

// An append-only effect barrier, independent of native effect implementation.
// The production port must use exclusively created System-owned files. A
// reservation is not completion, and observing a disk cannot settle it.
internal sealed class WindowsStorageBrokerExchangeJournal(
    WindowsStorageBrokerProtocol.Binding binding,
    Func<string, IReadOnlyList<byte[]>> read,
    Action<string, int, byte[]> append)
{
    internal const int MaximumEvents = 8;
    internal sealed record Admission(bool EffectAllowed, bool Replayed, WindowsStorageBrokerExchangeProtocol.Proof? Result);
    internal sealed record State(string OperationId, string TaskScopeSha256, string InputManifestSha256, string Phase, WindowsStorageBrokerExchangeProtocol.Proof? Proof);
    internal sealed record RecordedResult(string Status, WindowsStorageBrokerExchangeProtocol.Proof? Proof);
    private sealed record Entry(int Sequence, string PreviousSha256, string Action, string RequestId, string OperationId, string TaskScopeSha256, string InputManifestSha256, string EffectSha256, string Phase, WindowsStorageBrokerExchangeProtocol.Proof? Proof);
    private sealed record Observed(List<Entry> Entries, string Digest);
    private static Exception Invalid() => new InvalidOperationException("Preserve the original bounded exchange journal; no native effect may be replayed or inferred.");
    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Exact(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid(); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid();
        if (seen.Count != names.Length) throw Invalid();
    }
    private static WindowsStorageBrokerExchangeProtocol.Proof Unknown() => new("outcome-unconfirmed", true, false, false, false, false);
    private static WindowsStorageBrokerExchangeProtocol.RequestScope Scope(WindowsStorageBrokerProtocol.Binding binding, Entry entry) =>
        WindowsStorageBrokerExchangeProtocol.ReadRequest(WindowsStorageBrokerExchangeProtocol.Request(binding, entry.Action, entry.RequestId, entry.OperationId, entry.TaskScopeSha256, entry.InputManifestSha256, new string('a', 64)), binding);
    private static bool SameScope(Entry entry, WindowsStorageBrokerExchangeProtocol.RequestScope request) => entry.OperationId == request.OperationId && entry.TaskScopeSha256 == request.TaskScopeSha256 && entry.InputManifestSha256 == request.InputManifestSha256;
    private static bool Allowed(string? previous, string action) => (previous, action) is (null, "create") or ("created", "attach") or ("mounted", "detach") or ("created", "retire") or ("detached", "retire");
    private Observed Observe(string operationId)
    {
        var bytes = read(operationId); if (bytes.Count > MaximumEvents) throw Invalid(); var entries = new List<Entry>(); string digest = new('0', 64);
        foreach (byte[] raw in bytes)
        {
            if (raw.Length is < 2 or > 8192) throw Invalid();
            using var document = JsonDocument.Parse(raw, new JsonDocumentOptions { MaxDepth = 4 }); var value = document.RootElement;
            Exact(value, "schema", "sequence", "previousSha256", "action", "requestId", "operationId", "taskScopeSha256", "inputManifestSha256", "effectSha256", "phase", "proof");
            if (value.GetProperty("schema").GetString() != "switchyard-windows-exchange-journal/v1") throw Invalid();
            string Text(string name) => value.GetProperty(name).GetString() ?? throw Invalid();
            WindowsStorageBrokerExchangeProtocol.Proof? proof = null; var result = value.GetProperty("proof");
            if (result.ValueKind != JsonValueKind.Null)
            {
                Exact(result, "state", "effectStarted", "attached", "mounted", "detachedVerified", "exchangeQuotaEnforced");
                proof = new(result.GetProperty("state").GetString() ?? "", result.GetProperty("effectStarted").GetBoolean(), result.GetProperty("attached").GetBoolean(), result.GetProperty("mounted").GetBoolean(), result.GetProperty("detachedVerified").GetBoolean(), result.GetProperty("exchangeQuotaEnforced").GetBoolean());
            }
            var entry = new Entry(value.GetProperty("sequence").GetInt32(), Text("previousSha256"), Text("action"), Text("requestId"), Text("operationId"), Text("taskScopeSha256"), Text("inputManifestSha256"), Text("effectSha256"), Text("phase"), proof);
            var scope = Scope(binding, entry);
            if (entry.Sequence != entries.Count || entry.PreviousSha256 != digest || entry.OperationId != operationId || entry.EffectSha256 != scope.EffectDigest || entry.Action == "inspect" || entries.Count > 0 && !SameScope(entries[0], scope)) throw Invalid();
            var previous = entries.LastOrDefault();
            if (entry.Phase == "reserved")
            {
                if (proof != null || previous != null && (previous.Phase != "recorded" || previous.Proof?.State == "outcome-unconfirmed") || entries.Any(e => e.RequestId == entry.RequestId) || !Allowed(previous?.Proof?.State, entry.Action)) throw Invalid();
            }
            else if (entry.Phase == "recorded")
            {
                if (proof == null || previous?.Phase != "reserved" || previous.RequestId != entry.RequestId || previous.EffectSha256 != entry.EffectSha256) throw Invalid();
                WindowsStorageBrokerExchangeProtocol.CheckProof(scope, proof);
            }
            else throw Invalid();
            entries.Add(entry); digest = Sha(raw);
        }
        return new(entries, digest);
    }
    private void Append(Observed observed, WindowsStorageBrokerExchangeProtocol.RequestScope request, string phase, WindowsStorageBrokerExchangeProtocol.Proof? proof)
    {
        if (observed.Entries.Count >= MaximumEvents) throw Invalid();
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schema = "switchyard-windows-exchange-journal/v1", sequence = observed.Entries.Count, previousSha256 = observed.Digest,
            action = request.Action, requestId = request.RequestId, operationId = request.OperationId, taskScopeSha256 = request.TaskScopeSha256,
            inputManifestSha256 = request.InputManifestSha256, effectSha256 = request.EffectDigest, phase,
            proof = proof == null ? null : new { state = proof.State, effectStarted = proof.EffectStarted, attached = proof.Attached, mounted = proof.Mounted, detachedVerified = proof.DetachedVerified, exchangeQuotaEnforced = proof.ExchangeQuotaEnforced }
        });
        append(request.OperationId, observed.Entries.Count, bytes);
        var retained = Observe(request.OperationId);
        if (retained.Entries.Count != observed.Entries.Count + 1 || retained.Digest != Sha(bytes)) throw Invalid();
    }
    internal Admission Begin(WindowsStorageBrokerExchangeProtocol.RequestScope request)
    {
        WindowsStorageBrokerExchangeProtocol.CheckRequest(binding, request); var observed = Observe(request.OperationId); var entries = observed.Entries;
        if (entries.Count > 0 && !SameScope(entries[0], request)) throw Invalid();
        var original = entries.FirstOrDefault(e => e.RequestId == request.RequestId);
        if (original != null)
        {
            if (original.EffectSha256 != request.EffectDigest) throw Invalid();
            return new(false, true, entries.FirstOrDefault(e => e.RequestId == request.RequestId && e.Phase == "recorded")?.Proof ?? Unknown());
        }
        var latest = entries.LastOrDefault();
        if (request.Action == "inspect") return new(false, false, latest?.Phase == "recorded" ? latest.Proof! with { EffectStarted = false } : latest == null ? null : Unknown() with { EffectStarted = false });
        if (latest?.Phase == "reserved" || !Allowed(latest?.Proof?.State, request.Action)) throw Invalid();
        Append(observed, request, "reserved", null);
        return new(true, false, null);
    }
    internal State? Current(string operationId)
    {
        var observed = Observe(operationId); var latest = observed.Entries.LastOrDefault();
        return latest == null ? null : new(latest.OperationId, latest.TaskScopeSha256, latest.InputManifestSha256, latest.Phase, latest.Proof);
    }
    internal RecordedResult Lookup(WindowsStorageBrokerExchangeProtocol.RequestScope request)
    {
        WindowsStorageBrokerExchangeProtocol.CheckRequest(binding, request); var observed = Observe(request.OperationId);
        if (observed.Entries.Count > 0 && !SameScope(observed.Entries[0], request)) throw Invalid();
        var original = observed.Entries.FirstOrDefault(entry => entry.RequestId == request.RequestId);
        if (original == null) return new("absent", null);
        if (original.EffectSha256 != request.EffectDigest) throw Invalid();
        var recorded = observed.Entries.FirstOrDefault(entry => entry.RequestId == request.RequestId && entry.Phase == "recorded");
        return recorded == null ? new("reserved", null) : new("recorded", recorded.Proof ?? throw Invalid());
    }
    internal void Complete(WindowsStorageBrokerExchangeProtocol.RequestScope request, WindowsStorageBrokerExchangeProtocol.Proof proof)
    {
        WindowsStorageBrokerExchangeProtocol.CheckRequest(binding, request); WindowsStorageBrokerExchangeProtocol.CheckProof(request, proof);
        var observed = Observe(request.OperationId); var latest = observed.Entries.LastOrDefault();
        if (latest == null || latest.RequestId != request.RequestId || latest.EffectSha256 != request.EffectDigest || !SameScope(latest, request)) throw Invalid();
        if (latest.Phase == "recorded") { if (latest.Proof != proof) throw Invalid(); return; }
        if (latest.Phase != "reserved") throw Invalid(); Append(observed, request, "recorded", proof);
    }
}
