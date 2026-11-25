using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// Pure historical packet validation. Git ancestry/freshness and authority remain
// host responsibilities; this parser verifies exact immutable blob bytes only.
internal static class ReviewedHistoryInputs
{
    private const string Prefix = ".switchyard-history/";
    private static readonly Regex Digest = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex ObjectId = new("^(?:[a-f0-9]{40}|[a-f0-9]{64})$", RegexOptions.CultureInvariant);
    private static readonly Regex Reserved = new(@"^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    internal sealed class Packet : IDisposable
    {
        internal readonly IReadOnlyDictionary<string, byte[]> Files;
        internal readonly string Digest, WitnessDigest;
        internal Packet(Dictionary<string, byte[]> files, string digest, string witnessDigest) { Files=files; Digest=digest; WitnessDigest=witnessDigest; }
        public void Dispose() { foreach(var bytes in Files.Values) CryptographicOperations.ZeroMemory(bytes); }
    }
    private sealed record Source(string ObjectId,string Sha256,int Size);
    private static Exception Invalid()=>new InvalidOperationException("The exact bounded private historical packet did not verify.");
    private static string Sha(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static bool Oid(string value,int length)=>value.Length==length&&ObjectId.IsMatch(value)&&!value.All(c=>c=='0');
    private static void Exact(JsonElement value,params string[] fields)
    {
        if(value.ValueKind!=JsonValueKind.Object||value.EnumerateObject().Count()!=fields.Length||value.EnumerateObject().Any(property=>!fields.Contains(property.Name,StringComparer.Ordinal)))throw Invalid();
    }
    private static string PathName(JsonElement value,int max=512,int components=32)
    {
        string path=value.GetString()??throw Invalid();
        if(path.Length<1||path.Length>max||path.Any(char.IsControl)||path.IndexOfAny(new[]{'\\',':','*','?','[',']'})>=0||path.Split('/').Length>components||path.Split('/').Any(part=>part.Length==0||part is "." or ".."||part.Equals(".git",StringComparison.OrdinalIgnoreCase)||part.EndsWith(' ')||part.EndsWith('.')||Reserved.IsMatch(part)))throw Invalid();
        return path;
    }
    internal static Packet Read(JsonElement packet,IReadOnlyDictionary<string,(string Sha256,int Size)> inputFiles,bool withIndex=false)
    {
        var buffers=new Dictionary<string,byte[]>(StringComparer.Ordinal);
        try
        {
            byte[] serialized=Encoding.UTF8.GetBytes(packet.GetRawText());string digest;
            try{if(serialized.Length>524288)throw Invalid();digest=Sha(serialized);}finally{CryptographicOperations.ZeroMemory(serialized);}
            Exact(packet,"schema","action","witness","files");
            if(packet.GetProperty("schema").GetString()!="switchyard-windows-history-bytes/v1"||packet.GetProperty("action").GetString() is not ("shield_codebase_audit" or "release_shield"))throw Invalid();
            var witness=packet.GetProperty("witness");Exact(witness,"source","head","paths","requestedDepth","historyMetadataSha256","stopping","shallow","rows");
            string head=witness.GetProperty("head").GetString()??"";
            if(witness.GetProperty("source").GetString()!="git-history"||!Oid(head,head.Length)||!Digest.IsMatch(witness.GetProperty("historyMetadataSha256").GetString()??"")||!witness.GetProperty("requestedDepth").TryGetInt32(out int depth)||depth is <1 or >6||witness.GetProperty("shallow").ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw Invalid();
            var stopping=witness.GetProperty("stopping");Exact(stopping,"kind","nextFirstParent");string kind=stopping.GetProperty("kind").GetString()??"";var next=stopping.GetProperty("nextFirstParent");
            if(kind is not ("root" or "depth" or "shallow")||(kind=="root"?next.ValueKind!=JsonValueKind.Null:!Oid(next.GetString()??"",head.Length))||kind=="shallow"&&!witness.GetProperty("shallow").GetBoolean())throw Invalid();
            var selected=witness.GetProperty("paths");if(selected.ValueKind!=JsonValueKind.Array||selected.GetArrayLength() is <1 or >8)throw Invalid();
            var paths=new HashSet<string>(StringComparer.Ordinal);var folded=new HashSet<string>(StringComparer.OrdinalIgnoreCase);string? previous=null;
            foreach(var name in selected.EnumerateArray())
            {
                string path=PathName(name,384,28);
                if(path.StartsWith(Prefix,StringComparison.Ordinal)||path==Prefix.TrimEnd('/')||path.StartsWith(".switchyard-index/",StringComparison.Ordinal)||path==".switchyard-index"||!paths.Add(path)||!folded.Add(path)||previous!=null&&string.CompareOrdinal(previous,path)>=0)throw Invalid();previous=path;
            }
            var rows=witness.GetProperty("rows");if(rows.ValueKind!=JsonValueKind.Array||rows.GetArrayLength() is <1 or >48||!withIndex&&inputFiles.Keys.Any(path=>path.StartsWith(".switchyard-index/",StringComparison.Ordinal)))throw Invalid();
            var sources=new Dictionary<string,Source>(StringComparer.Ordinal);var used=new HashSet<string>(StringComparer.Ordinal);var commits=new HashSet<string>(StringComparer.Ordinal);long total=0;
            foreach(var row in rows.EnumerateArray())
            {
                Exact(row,"commit","path","mode","objectId","size","sha256");string commit=row.GetProperty("commit").GetString()??"",original=PathName(row.GetProperty("path"),384,28),objectId=row.GetProperty("objectId").GetString()??"",sha=row.GetProperty("sha256").GetString()??"",path=Prefix+commit+"/"+original;
                if(!Oid(commit,head.Length)||!Oid(objectId,head.Length)||!paths.Contains(original)||sources.ContainsKey(path)||row.GetProperty("mode").GetString() is not ("100644" or "100755")||!Digest.IsMatch(sha)||!row.GetProperty("size").TryGetInt32(out int size)||size is <0 or >262144||!inputFiles.TryGetValue(path,out var input)||input.Size!=size||input.Sha256!=sha)throw Invalid();
                used.Add(original);commits.Add(commit);total+=size;if(total>327680||commits.Count>depth)throw Invalid();sources.Add(path,new Source(objectId,sha,size));
            }
            if(used.Count!=paths.Count||inputFiles.Keys.Count(path=>path.StartsWith(Prefix,StringComparison.Ordinal))!=sources.Count)throw Invalid();
            var files=packet.GetProperty("files");if(files.ValueKind!=JsonValueKind.Array||files.GetArrayLength()!=sources.Count)throw Invalid();
            foreach(var file in files.EnumerateArray())
            {
                Exact(file,"path","contentBase64");string path=PathName(file.GetProperty("path"));if(!sources.TryGetValue(path,out var source)||buffers.ContainsKey(path))throw Invalid();
                string encoded=file.GetProperty("contentBase64").GetString()??throw Invalid();if(encoded.Length!=((source.Size+2)/3)*4)throw Invalid();byte[]? bytes=null;
                try
                {
                    bytes=Convert.FromBase64String(encoded);if(bytes.Length!=source.Size||Convert.ToBase64String(bytes)!=encoded||Sha(bytes)!=source.Sha256)throw Invalid();
                    using var hash=IncrementalHash.CreateHash(source.ObjectId.Length==40?HashAlgorithmName.SHA1:HashAlgorithmName.SHA256);hash.AppendData(Encoding.UTF8.GetBytes("blob "+source.Size.ToString(CultureInfo.InvariantCulture)+"\0"));hash.AppendData(bytes);if(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()!=source.ObjectId)throw Invalid();buffers.Add(path,bytes);bytes=null;
                }
                finally{if(bytes!=null)CryptographicOperations.ZeroMemory(bytes);}
            }
            return new Packet(buffers,digest,Sha(Encoding.UTF8.GetBytes(witness.GetRawText())));
        }
        catch{foreach(var bytes in buffers.Values)CryptographicOperations.ZeroMemory(bytes);throw Invalid();}
    }
}
