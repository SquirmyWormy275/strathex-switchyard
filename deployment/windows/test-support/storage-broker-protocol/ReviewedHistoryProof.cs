using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
internal static class ReviewedHistoryProof
{
    private static string Sha(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static (JsonObject Packet,Dictionary<string,(string Sha256,int Size)> Inputs) Fixture(int size,bool sha256=false,string name="app.js")
    {
        byte[] bytes=Enumerable.Repeat((byte)65,size).ToArray();using var hash=IncrementalHash.CreateHash(sha256?HashAlgorithmName.SHA256:HashAlgorithmName.SHA1);hash.AppendData(Encoding.UTF8.GetBytes("blob "+size.ToString(CultureInfo.InvariantCulture)+"\0"));hash.AppendData(bytes);
        string id=Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(),commit=new('a',sha256?64:40),path=".switchyard-history/"+commit+"/"+name,digest=Sha(bytes);
        var row=new JsonObject{["commit"]=commit,["path"]=name,["mode"]="100644",["objectId"]=id,["size"]=size,["sha256"]=digest};
        var packet=new JsonObject{["schema"]="switchyard-windows-history-bytes/v1",["action"]="shield_codebase_audit",["witness"]=new JsonObject{["source"]="git-history",["head"]=commit,["paths"]=new JsonArray(name),["requestedDepth"]=4,["historyMetadataSha256"]=new string('b',64),["stopping"]=new JsonObject{["kind"]="root",["nextFirstParent"]=null},["shallow"]=false,["rows"]=new JsonArray(row)},["files"]=new JsonArray(new JsonObject{["path"]=path,["contentBase64"]=Convert.ToBase64String(bytes)})};return(packet,new Dictionary<string,(string,int)>(StringComparer.Ordinal){[path]=(digest,size)});
    }
    private static ReviewedHistoryInputs.Packet Read(JsonObject packet,Dictionary<string,(string Sha256,int Size)> inputs){using var document=JsonDocument.Parse(packet.ToJsonString());return ReviewedHistoryInputs.Read(document.RootElement,inputs);}
    internal static int Run()
    {
        int checks=0;
        void Require(bool value){if(!value)throw new InvalidOperationException("Historical private input proof failed.");checks++;}
        void Refuses(Action action){try{action();}catch(InvalidOperationException){checks++;return;}throw new InvalidOperationException("Invalid historical packet was accepted.");}
        foreach(bool algorithm in new[]{false,true})foreach(int size in new[]{0,42,262144})
        {
            var f=Fixture(size,algorithm);var packet=Read(f.Packet,f.Inputs);byte[] held=packet.Files.Values.Single();Require(held.Length==size&&held.All(b=>b==65));Require(packet.Digest==Sha(Encoding.UTF8.GetBytes(f.Packet.ToJsonString())));Require(packet.WitnessDigest==Sha(Encoding.UTF8.GetBytes(f.Packet["witness"]!.ToJsonString())));packet.Dispose();Require(held.All(b=>b==0));
        }
        Action<JsonObject>[] invalid={
            p=>p["action"]="run_target",p=>p["action"]="shield_change_scan",p=>p["command"]="invented",p=>p["witness"]!["source"]="git-index",p=>p["witness"]!["head"]=new string('0',40),p=>p["witness"]!["historyMetadataSha256"]="missing",p=>p["witness"]!["requestedDepth"]=7,p=>p["witness"]!["requestedDepth"]=0,p=>p["witness"]!["paths"]![0]="../foreign",p=>p["witness"]!["paths"]![0]="NUL.txt",p=>p["witness"]!["paths"]!.AsArray().Add("APP.js"),p=>p["witness"]!["shallow"]="false",p=>p["witness"]!["stopping"]!["kind"]="complete",p=>p["witness"]!["stopping"]!["kind"]="depth",p=>p["witness"]!["stopping"]!["nextFirstParent"]=new string('c',40),p=>p["witness"]!["rows"]![0]!["commit"]="HEAD",p=>p["witness"]!["rows"]![0]!["commit"]=new string('0',40),p=>p["witness"]!["rows"]![0]!["path"]="other.js",p=>p["witness"]!["rows"]![0]!["mode"]="120000",p=>p["witness"]!["rows"]![0]!["objectId"]=new string('c',40),p=>p["witness"]!["rows"]![0]!["size"]=25,p=>p["witness"]!["rows"]![0]!["sha256"]=new string('c',64),p=>p["witness"]!["rows"]!.AsArray().Add(p["witness"]!["rows"]![0]!.DeepClone()),p=>p["files"]![0]!["path"]="engine.mjs",p=>p["files"]![0]!["contentBase64"]="not-base64",p=>p["files"]![0]!["contentBase64"]=Convert.ToBase64String(new byte[24]),p=>p["files"]!.AsArray().Add(p["files"]![0]!.DeepClone()),p=>p["witness"]!["rows"]![0]!["grant"]=true
        };
        foreach(var change in invalid){var f=Fixture(24);change(f.Packet);Refuses(()=>Read(f.Packet,f.Inputs).Dispose());}
        var missing=Fixture(24);missing.Inputs.Clear();Refuses(()=>Read(missing.Packet,missing.Inputs).Dispose());var alias=Fixture(24);alias.Inputs.Add(".switchyard-history/"+new string('b',40)+"/other.js",(new string('c',64),24));Refuses(()=>Read(alias.Packet,alias.Inputs).Dispose());var mixed=Fixture(24);mixed.Inputs.Add(".switchyard-index/app.js",(new string('c',64),24));Refuses(()=>Read(mixed.Packet,mixed.Inputs).Dispose());var huge=Fixture(262145);Refuses(()=>Read(huge.Packet,huge.Inputs).Dispose());
        var full=Fixture(262144);var second=Fixture(65536,name:"other.js");full.Packet["witness"]!["paths"]!.AsArray().Add("other.js");full.Packet["witness"]!["rows"]!.AsArray().Add(second.Packet["witness"]!["rows"]![0]!.DeepClone());full.Packet["files"]!.AsArray().Add(second.Packet["files"]![0]!.DeepClone());foreach(var pair in second.Inputs)full.Inputs.Add(pair.Key,pair.Value);using(var bounded=Read(full.Packet,full.Inputs))Require(bounded.Files.Values.Sum(bytes=>bytes.Length)==327680);
        var over=Fixture(65537,name:"other.js");full.Packet["witness"]!["rows"]![1]=over.Packet["witness"]!["rows"]![0]!.DeepClone();full.Packet["files"]![1]=over.Packet["files"]![0]!.DeepClone();foreach(var pair in over.Inputs)full.Inputs[pair.Key]=pair.Value;Refuses(()=>Read(full.Packet,full.Inputs).Dispose());
        // Literal Node JSON must retain original UTF-8 and base64 hash bytes.
        using(var node=JsonDocument.Parse("""{"schema":"switchyard-windows-history-bytes/v1","action":"shield_codebase_audit","witness":{"source":"git-history","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","paths":["src/café.js"],"requestedDepth":4,"historyMetadataSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","stopping":{"kind":"root","nextFirstParent":null},"shallow":false,"rows":[{"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"src/café.js","mode":"100644","objectId":"1fad523268d827ec2f3413761c449f2cb4518087","size":5,"sha256":"47fe2fead14e4bc2fee6252c82badeffbd1fa586e5a72d0f0a2d900393afa620"}]},"files":[{"path":".switchyard-history/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/café.js","contentBase64":"8J+YigA="}]}"""))
        {
            var inputs=new Dictionary<string,(string,int)>(StringComparer.Ordinal){[".switchyard-history/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/src/café.js"]=("47fe2fead14e4bc2fee6252c82badeffbd1fa586e5a72d0f0a2d900393afa620",5)};
            var packet=ReviewedHistoryInputs.Read(node.RootElement,inputs);byte[] held=packet.Files.Values.Single();Require(packet.Digest=="8f3a8a9cbeece989765d67aef914b94b76cc08683697efed166c83de3e3b8209");Require(packet.WitnessDigest=="c13fe2164615bbe859db564d58e9e317779ae0d985697a8a551e196381e3ec6d");Require(held.SequenceEqual(new byte[]{240,159,152,138,0}));packet.Dispose();Require(held.All(b=>b==0));
        }
        return checks;
    }
}
