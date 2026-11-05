using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// Closed data-volume requests. Caller identity is still established by the
// kernel pipe, and trust in this key still comes from protected installation.
internal static class WindowsStorageBrokerExchangeProtocol
{
    internal const string Schema = "switchyard-windows-broker-exchange/v1";
    internal const long VirtualBytes = 64L * 1024 * 1024, BackingBytes = VirtualBytes + 512;
    internal sealed record RequestScope(string Action, string RequestId, string OperationId, string TaskScopeSha256, string InputManifestSha256, string Nonce, string Digest, string EffectDigest);
    internal sealed record Proof(string State, bool EffectStarted, bool Attached, bool Mounted, bool DetachedVerified, bool ExchangeQuotaEnforced);
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static Exception Invalid() => new InvalidOperationException("The exact bounded broker exchange request or signed result did not verify.");
    private static bool Digest(string value) => Regex.IsMatch(value, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private static bool Uuid(string value) => Guid.TryParseExact(value, "D", out var id) && id != Guid.Empty && id.ToString("D") == value;
    private static void Exact(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid();
        if (seen.Count != names.Length) throw Invalid();
    }
    private static JsonDocument Parse(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length is < 2 or > 16384) throw Invalid();
        return JsonDocument.Parse(Utf8.GetString(bytes), new JsonDocumentOptions { MaxDepth = 8 });
    }
    private static string Sha(ReadOnlySpan<byte> bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Binding(WindowsStorageBrokerProtocol.Binding binding) => WindowsStorageBrokerProtocol.Request(binding, new string('a', 64));
    private static void Scope(string action, string requestId, string operationId, string taskScope, string inputs, string nonce)
    {
        if (action is not ("create" or "inspect" or "attach" or "detach" or "retire") || !Uuid(requestId) || !Uuid(operationId) || !Digest(taskScope) || !Digest(inputs) || !Digest(nonce)) throw Invalid();
    }
    private static byte[] Canonical(WindowsStorageBrokerProtocol.Binding binding, string action, string requestId, string operationId, string taskScope, string inputs, string? nonce) =>
        Utf8.GetBytes(JsonSerializer.Serialize(new { schema = Schema, action, installationId = binding.InstallationId, ownerScope = binding.OwnerScope, requestId, operationId, taskScopeSha256 = taskScope, inputManifestSha256 = inputs, nonce }));
    internal static byte[] Request(WindowsStorageBrokerProtocol.Binding binding, string action, string requestId, string operationId, string taskScope, string inputs, string nonce)
    {
        Binding(binding); Scope(action, requestId, operationId, taskScope, inputs, nonce);
        return Canonical(binding, action, requestId, operationId, taskScope, inputs, nonce);
    }
    internal static RequestScope ReadRequest(ReadOnlySpan<byte> bytes, WindowsStorageBrokerProtocol.Binding binding)
    {
        Binding(binding); using var json = Parse(bytes); var value = json.RootElement;
        Exact(value, "schema", "action", "installationId", "ownerScope", "requestId", "operationId", "taskScopeSha256", "inputManifestSha256", "nonce");
        string Text(string name) => value.GetProperty(name).GetString() ?? throw Invalid();
        string action = Text("action"), requestId = Text("requestId"), operationId = Text("operationId"), taskScope = Text("taskScopeSha256"), inputs = Text("inputManifestSha256"), nonce = Text("nonce");
        if (Text("schema") != Schema || Text("installationId") != binding.InstallationId || Text("ownerScope") != binding.OwnerScope) throw Invalid();
        Scope(action, requestId, operationId, taskScope, inputs, nonce);
        return new(action, requestId, operationId, taskScope, inputs, nonce, Sha(Canonical(binding, action, requestId, operationId, taskScope, inputs, nonce)), Sha(Canonical(binding, action, requestId, operationId, taskScope, inputs, null)));
    }
    private static void CheckRequest(WindowsStorageBrokerProtocol.Binding binding, RequestScope request)
    {
        var expected = ReadRequest(Request(binding, request.Action, request.RequestId, request.OperationId, request.TaskScopeSha256, request.InputManifestSha256, request.Nonce), binding);
        if (request != expected) throw Invalid();
    }
    private static void CheckProof(RequestScope request, Proof proof)
    {
        if (proof.State is not ("created" or "mounted" or "detached" or "retired" or "outcome-unconfirmed") || proof.Mounted && !proof.Attached
            || proof.ExchangeQuotaEnforced != (proof.Mounted && proof.Attached) || proof.DetachedVerified != (!proof.Mounted && !proof.Attached && proof.State is "created" or "detached" or "retired")) throw Invalid();
        if (proof.State == "mounted" && (!proof.Mounted || !proof.Attached) || proof.State is "created" or "detached" or "retired" && (proof.Mounted || proof.Attached)) throw Invalid();
        if (proof.State != "outcome-unconfirmed" && (request.Action switch { "create" => proof.State != "created", "attach" => proof.State != "mounted", "detach" => proof.State != "detached", "retire" => proof.State != "retired", "inspect" => false, _ => true })) throw Invalid();
        if (request.Action == "inspect" && proof.EffectStarted || request.Action != "inspect" && proof.State != "outcome-unconfirmed" && !proof.EffectStarted) throw Invalid();
    }
    private static void P256(ECDsa key)
    {
        if (key.KeySize != 256 || key.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7") throw Invalid();
    }
    internal static byte[] Reply(WindowsStorageBrokerProtocol.Binding binding, RequestScope request, Proof proof, ECDsa key)
    {
        CheckRequest(binding, request); CheckProof(request, proof); P256(key);
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            schema = Schema, action = request.Action, installationId = binding.InstallationId, ownerScope = binding.OwnerScope,
            serviceImageSha256 = binding.ServiceImageSha256, requestId = request.RequestId, operationId = request.OperationId,
            taskScopeSha256 = request.TaskScopeSha256, inputManifestSha256 = request.InputManifestSha256, nonce = request.Nonce,
            requestSha256 = request.Digest, effectSha256 = request.EffectDigest,
            proof = new { state = proof.State, effectStarted = proof.EffectStarted, attached = proof.Attached, mounted = proof.Mounted, detachedVerified = proof.DetachedVerified, exchangeQuotaEnforced = proof.ExchangeQuotaEnforced, virtualBytes = VirtualBytes, backingBytes = BackingBytes, sandboxEnforced = false }
        });
        byte[] signature = key.SignData(payload, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        try { return JsonSerializer.SerializeToUtf8Bytes(new { schema = Schema, payload = Utf8.GetString(payload), signature = Convert.ToBase64String(signature) }); }
        finally { CryptographicOperations.ZeroMemory(payload); CryptographicOperations.ZeroMemory(signature); }
    }
    internal static Proof Verify(ReadOnlySpan<byte> bytes, WindowsStorageBrokerProtocol.Binding binding, RequestScope request, ReadOnlySpan<byte> publicKey)
    {
        CheckRequest(binding, request); if (publicKey.Length is < 64 or > 256) throw Invalid();
        using var json = Parse(bytes); var envelope = json.RootElement; Exact(envelope, "schema", "payload", "signature");
        string payload = envelope.GetProperty("payload").GetString() ?? "", encoded = envelope.GetProperty("signature").GetString() ?? "";
        if (envelope.GetProperty("schema").GetString() != Schema || Utf8.GetByteCount(payload) is < 2 or > 8192 || encoded.Length != 88) throw Invalid();
        byte[] signature = Convert.FromBase64String(encoded), content = Utf8.GetBytes(payload);
        try
        {
            using var key = ECDsa.Create(); key.ImportSubjectPublicKeyInfo(publicKey, out int read); P256(key);
            if (read != publicKey.Length || signature.Length != 64 || Convert.ToBase64String(signature) != encoded || !key.VerifyData(content, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation)) throw Invalid();
            using var parsed = Parse(content); var value = parsed.RootElement;
            Exact(value, "schema", "action", "installationId", "ownerScope", "serviceImageSha256", "requestId", "operationId", "taskScopeSha256", "inputManifestSha256", "nonce", "requestSha256", "effectSha256", "proof");
            foreach (var expected in new[] { ("schema", Schema), ("action", request.Action), ("installationId", binding.InstallationId), ("ownerScope", binding.OwnerScope), ("serviceImageSha256", binding.ServiceImageSha256), ("requestId", request.RequestId), ("operationId", request.OperationId), ("taskScopeSha256", request.TaskScopeSha256), ("inputManifestSha256", request.InputManifestSha256), ("nonce", request.Nonce), ("requestSha256", request.Digest), ("effectSha256", request.EffectDigest) }) if (value.GetProperty(expected.Item1).GetString() != expected.Item2) throw Invalid();
            var result = value.GetProperty("proof"); Exact(result, "state", "effectStarted", "attached", "mounted", "detachedVerified", "exchangeQuotaEnforced", "virtualBytes", "backingBytes", "sandboxEnforced");
            if (result.GetProperty("virtualBytes").GetInt64() != VirtualBytes || result.GetProperty("backingBytes").GetInt64() != BackingBytes || result.GetProperty("sandboxEnforced").ValueKind != JsonValueKind.False) throw Invalid();
            var proof = new Proof(result.GetProperty("state").GetString() ?? "", result.GetProperty("effectStarted").GetBoolean(), result.GetProperty("attached").GetBoolean(), result.GetProperty("mounted").GetBoolean(), result.GetProperty("detachedVerified").GetBoolean(), result.GetProperty("exchangeQuotaEnforced").GetBoolean());
            CheckProof(request, proof); return proof;
        }
        finally { CryptographicOperations.ZeroMemory(signature); CryptographicOperations.ZeroMemory(content); }
    }
}
