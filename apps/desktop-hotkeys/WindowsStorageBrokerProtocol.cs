using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// The protected installation supplies the public key and exact owner/image
// binding. This protocol cannot establish trust in an unverified installation.
internal static class WindowsStorageBrokerProtocol
{
    internal const string Schema = "switchyard-windows-storage-broker/v1";
    private static readonly UTF8Encoding Utf8 = new(false, true);
    internal sealed record Binding(string InstallationId, string OwnerScope, string ServiceImageSha256);
    internal sealed record MetadataRequest(string Nonce, string Digest);

    private static Exception Invalid() => new InvalidOperationException("The exact authenticated Windows storage broker observation did not verify.");
    private static void Exact(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid();
        if (seen.Count != names.Length) throw Invalid();
    }
    private static bool Digest(string? value) => value != null && Regex.IsMatch(value, "^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private static void Validate(Binding binding)
    {
        if (!Guid.TryParseExact(binding.InstallationId, "D", out var id) || id == Guid.Empty || id.ToString("D") != binding.InstallationId || !Digest(binding.OwnerScope) || !Digest(binding.ServiceImageSha256)) throw Invalid();
    }
    private static JsonDocument Parse(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length is < 2 or > 16384) throw Invalid();
        return JsonDocument.Parse(Utf8.GetString(bytes), new JsonDocumentOptions { MaxDepth = 8 });
    }
    private static byte[] CanonicalRequest(Binding binding, string nonce) => Utf8.GetBytes(JsonSerializer.Serialize(new
    {
        schema = Schema, action = "metadata", installationId = binding.InstallationId, ownerScope = binding.OwnerScope, nonce
    }));
    internal static byte[] Request(Binding binding, string nonce)
    {
        Validate(binding); if (!Digest(nonce)) throw Invalid(); return CanonicalRequest(binding, nonce);
    }
    internal static MetadataRequest ReadRequest(ReadOnlySpan<byte> bytes, Binding binding)
    {
        Validate(binding); using var document = Parse(bytes); var value = document.RootElement;
        Exact(value, "schema", "action", "installationId", "ownerScope", "nonce");
        string nonce = value.GetProperty("nonce").GetString() ?? "";
        if (value.GetProperty("schema").GetString() != Schema || value.GetProperty("action").GetString() != "metadata"
            || value.GetProperty("installationId").GetString() != binding.InstallationId || value.GetProperty("ownerScope").GetString() != binding.OwnerScope || !Digest(nonce)) throw Invalid();
        var canonical = CanonicalRequest(binding, nonce);
        return new MetadataRequest(nonce, Convert.ToHexString(SHA256.HashData(canonical)).ToLowerInvariant());
    }
    private static void Storage(JsonElement value)
    {
        Exact(value, "schema", "privilegeAssigned", "privilegeEnabled", "privilegeStateUnchanged", "requiresPrivilegedSetup", "brokerImplemented", "effectStarted", "sandboxEnforced");
        if (value.GetProperty("schema").GetString() != "switchyard-windows-storage-prerequisites/v1" || value.GetProperty("privilegeStateUnchanged").ValueKind != JsonValueKind.True
            || value.GetProperty("brokerImplemented").ValueKind != JsonValueKind.False || value.GetProperty("effectStarted").ValueKind != JsonValueKind.False || value.GetProperty("sandboxEnforced").ValueKind != JsonValueKind.False) throw Invalid();
        bool assigned = value.GetProperty("privilegeAssigned").GetBoolean(), enabled = value.GetProperty("privilegeEnabled").GetBoolean();
        if (enabled && !assigned || value.GetProperty("requiresPrivilegedSetup").GetBoolean() != !assigned) throw Invalid();
    }
    private static void P256(ECDsa key)
    {
        if (key.KeySize != 256 || key.ExportParameters(false).Curve.Oid.Value != "1.2.840.10045.3.1.7") throw Invalid();
    }
    internal static byte[] Reply(Binding binding, MetadataRequest request, JsonElement storage, ECDsa installationKey)
    {
        Validate(binding); if (!Digest(request.Nonce) || request.Digest != ReadRequest(Request(binding, request.Nonce), binding).Digest) throw Invalid(); Storage(storage); P256(installationKey);
        string payload = JsonSerializer.Serialize(new
        {
            schema = Schema, action = "metadata", installationId = binding.InstallationId, ownerScope = binding.OwnerScope,
            nonce = request.Nonce, requestSha256 = request.Digest, serviceImageSha256 = binding.ServiceImageSha256, storage
        });
        byte[] bytes = Utf8.GetBytes(payload), signature = installationKey.SignData(bytes, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        try { return Utf8.GetBytes(JsonSerializer.Serialize(new { schema = Schema, payload, signature = Convert.ToBase64String(signature) })); }
        finally { CryptographicOperations.ZeroMemory(bytes); CryptographicOperations.ZeroMemory(signature); }
    }
    internal static JsonElement Verify(ReadOnlySpan<byte> response, Binding binding, MetadataRequest request, ReadOnlySpan<byte> pinnedPublicKey)
    {
        Validate(binding); if (pinnedPublicKey.Length is < 64 or > 256 || request.Digest != ReadRequest(Request(binding, request.Nonce), binding).Digest) throw Invalid();
        using var document = Parse(response); var envelope = document.RootElement; Exact(envelope, "schema", "payload", "signature");
        string payload = envelope.GetProperty("payload").GetString() ?? "", encoded = envelope.GetProperty("signature").GetString() ?? "";
        if (envelope.GetProperty("schema").GetString() != Schema || Utf8.GetByteCount(payload) is < 2 or > 4096 || encoded.Length != 88) throw Invalid();
        byte[] signature = Convert.FromBase64String(encoded), bytes = Utf8.GetBytes(payload);
        try
        {
            using var key = ECDsa.Create(); key.ImportSubjectPublicKeyInfo(pinnedPublicKey, out int read); P256(key);
            if (read != pinnedPublicKey.Length || signature.Length != 64 || Convert.ToBase64String(signature) != encoded || !key.VerifyData(bytes, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation)) throw Invalid();
            using var parsed = Parse(bytes); var value = parsed.RootElement;
            Exact(value, "schema", "action", "installationId", "ownerScope", "nonce", "requestSha256", "serviceImageSha256", "storage");
            if (value.GetProperty("schema").GetString() != Schema || value.GetProperty("action").GetString() != "metadata" || value.GetProperty("installationId").GetString() != binding.InstallationId
                || value.GetProperty("ownerScope").GetString() != binding.OwnerScope || value.GetProperty("nonce").GetString() != request.Nonce || value.GetProperty("requestSha256").GetString() != request.Digest || value.GetProperty("serviceImageSha256").GetString() != binding.ServiceImageSha256) throw Invalid();
            Storage(value.GetProperty("storage")); return value.GetProperty("storage").Clone();
        }
        finally { CryptographicOperations.ZeroMemory(signature); CryptographicOperations.ZeroMemory(bytes); }
    }
}
