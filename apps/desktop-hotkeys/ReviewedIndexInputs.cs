using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// Pure packet validation, shared with portable proof. No filesystem access or
// authority is granted here. The host owns Git freshness and the exact grant.
internal static class ReviewedIndexInputs
{
    private const string Prefix = ".switchyard-index/";
    private static readonly Regex Digest = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex ObjectId = new("^(?:[a-f0-9]{40}|[a-f0-9]{64})$", RegexOptions.CultureInvariant);
    private static readonly Regex Reserved = new(@"^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    internal sealed class Packet : IDisposable
    {
        internal readonly IReadOnlyDictionary<string, byte[]> Files;
        internal readonly string Digest, WitnessDigest;
        internal Packet(Dictionary<string, byte[]> files, string digest, string witnessDigest) { Files = files; Digest = digest; WitnessDigest = witnessDigest; }
        public void Dispose() { foreach (var bytes in Files.Values) CryptographicOperations.ZeroMemory(bytes); }
    }
    private sealed record Source(string ObjectId, string Sha256, int Size);
    private static Exception Invalid() => new InvalidOperationException("The exact bounded private index packet did not verify.");
    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static void Exact(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != fields.Length || value.EnumerateObject().Any(property => !fields.Contains(property.Name, StringComparer.Ordinal))) throw Invalid();
    }
    private static string PathName(JsonElement value)
    {
        string path = value.GetString() ?? throw Invalid();
        if (path.Length is < 1 or > 512 || path.Any(char.IsControl) || path.IndexOfAny(new[] { '\\', ':', '*', '?', '[', ']' }) >= 0 || path.Split('/').Length > 32
            || path.Split('/').Any(part => part.Length == 0 || part is "." or ".." || part.Equals(".git", StringComparison.OrdinalIgnoreCase) || part.EndsWith(' ') || part.EndsWith('.') || Reserved.IsMatch(part))) throw Invalid();
        return path;
    }
    internal static Packet Read(JsonElement packet, IReadOnlyDictionary<string, (string Sha256, int Size)> inputFiles)
    {
        var buffers = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        try
        {
            byte[] serialized = Encoding.UTF8.GetBytes(packet.GetRawText());
            string digest;
            try { if (serialized.Length > 524288) throw Invalid(); digest = Sha(serialized); }
            finally { CryptographicOperations.ZeroMemory(serialized); }
            Exact(packet, "schema", "action", "witness", "files");
            if (packet.GetProperty("schema").GetString() != "switchyard-windows-index-bytes/v1" || packet.GetProperty("action").GetString() is not ("shield_change_scan" or "shield_codebase_audit" or "shield_supply_chain" or "release_shield")) throw Invalid();
            var witness = packet.GetProperty("witness"); Exact(witness, "source", "head", "indexMetadataSha256", "rows");
            string head = witness.GetProperty("head").GetString() ?? "";
            if (witness.GetProperty("source").GetString() != "git-index" || !ObjectId.IsMatch(head) || head.All(c => c == '0') || !Digest.IsMatch(witness.GetProperty("indexMetadataSha256").GetString() ?? "")) throw Invalid();
            var rows = witness.GetProperty("rows");
            if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() is < 1 or > 64) throw Invalid();
            var sources = new Dictionary<string, Source>(StringComparer.Ordinal); var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0; string? previous = null;
            foreach (var row in rows.EnumerateArray())
            {
                Exact(row, "path", "mode", "objectId", "size", "sha256");
                string original = PathName(row.GetProperty("path")), path = Prefix + original;
                string objectId = row.GetProperty("objectId").GetString() ?? "", sha = row.GetProperty("sha256").GetString() ?? "";
                if (original.StartsWith(Prefix, StringComparison.Ordinal) || original == Prefix.TrimEnd('/') || !names.Add(original) || previous != null && string.CompareOrdinal(previous, original) >= 0
                    || row.GetProperty("mode").GetString() is not ("100644" or "100755") || !ObjectId.IsMatch(objectId) || objectId.Length != head.Length || objectId.All(c => c == '0') || !Digest.IsMatch(sha)
                    || !row.GetProperty("size").TryGetInt32(out int size) || size is < 0 or > 262144 || !inputFiles.TryGetValue(path, out var input) || input.Size != size || input.Sha256 != sha) throw Invalid();
                previous = original; total += size; if (total > 327680) throw Invalid();
                sources.Add(path, new Source(objectId, sha, size));
            }
            if (inputFiles.Keys.Count(path => path.StartsWith(Prefix, StringComparison.Ordinal)) != sources.Count) throw Invalid();
            var files = packet.GetProperty("files"); if (files.ValueKind != JsonValueKind.Array || files.GetArrayLength() != sources.Count) throw Invalid();
            foreach (var file in files.EnumerateArray())
            {
                Exact(file, "path", "contentBase64"); string path = PathName(file.GetProperty("path"));
                if (!sources.TryGetValue(path, out var source) || buffers.ContainsKey(path)) throw Invalid();
                string encoded = file.GetProperty("contentBase64").GetString() ?? throw Invalid();
                if (encoded.Length != ((source.Size + 2) / 3) * 4) throw Invalid();
                byte[]? bytes = null;
                try
                {
                    bytes = Convert.FromBase64String(encoded);
                    if (bytes.Length != source.Size || Convert.ToBase64String(bytes) != encoded || Sha(bytes) != source.Sha256) throw Invalid();
                    using var objectHash = IncrementalHash.CreateHash(source.ObjectId.Length == 40 ? HashAlgorithmName.SHA1 : HashAlgorithmName.SHA256);
                    objectHash.AppendData(Encoding.UTF8.GetBytes("blob " + source.Size.ToString(CultureInfo.InvariantCulture) + "\0")); objectHash.AppendData(bytes);
                    if (Convert.ToHexString(objectHash.GetHashAndReset()).ToLowerInvariant() != source.ObjectId) throw Invalid();
                    buffers.Add(path, bytes); bytes = null;
                }
                finally { if (bytes != null) CryptographicOperations.ZeroMemory(bytes); }
            }
            return new Packet(buffers, digest, Sha(Encoding.UTF8.GetBytes(witness.GetRawText())));
        }
        catch { foreach (var bytes in buffers.Values) CryptographicOperations.ZeroMemory(bytes); throw Invalid(); }
    }
}
