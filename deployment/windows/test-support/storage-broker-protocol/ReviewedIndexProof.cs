using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ReviewedIndexProof
{
    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static (JsonObject Packet, Dictionary<string, (string Sha256, int Size)> Inputs) Fixture(int size, bool sha256 = false, string name = "app.js")
    {
        byte[] bytes = Enumerable.Repeat((byte)65, size).ToArray();
        using var hash = IncrementalHash.CreateHash(sha256 ? HashAlgorithmName.SHA256 : HashAlgorithmName.SHA1);
        hash.AppendData(Encoding.UTF8.GetBytes("blob " + size.ToString(CultureInfo.InvariantCulture) + "\0")); hash.AppendData(bytes);
        string id = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant(), path = ".switchyard-index/" + name, digest = Sha(bytes);
        var row = new JsonObject { ["path"] = name, ["mode"] = "100644", ["objectId"] = id, ["size"] = size, ["sha256"] = digest };
        var packet = new JsonObject { ["schema"] = "switchyard-windows-index-bytes/v1", ["action"] = "shield_change_scan", ["witness"] = new JsonObject { ["source"] = "git-index", ["head"] = new string('a', sha256 ? 64 : 40), ["indexMetadataSha256"] = new string('b', 64), ["rows"] = new JsonArray(row) }, ["files"] = new JsonArray(new JsonObject { ["path"] = path, ["contentBase64"] = Convert.ToBase64String(bytes) }) };
        return (packet, new Dictionary<string, (string, int)>(StringComparer.Ordinal) { [path] = (digest, size) });
    }
    private static ReviewedIndexInputs.Packet Read(JsonObject packet, Dictionary<string, (string Sha256, int Size)> inputs)
    {
        using var document = JsonDocument.Parse(packet.ToJsonString()); return ReviewedIndexInputs.Read(document.RootElement, inputs);
    }
    internal static int Run()
    {
        int checks = 0;
        void Require(bool value) { if (!value) throw new InvalidOperationException("Private index packet proof failed."); checks++; }
        void Refuses(Action action) { try { action(); } catch (InvalidOperationException) { checks++; return; } throw new InvalidOperationException("Invalid private index packet was accepted."); }
        foreach (bool sha256 in new[] { false, true }) foreach (int size in new[] { 0, 42, 262144 })
        {
            var f = Fixture(size, sha256); var packet = Read(f.Packet, f.Inputs); byte[] held = packet.Files[".switchyard-index/app.js"];
            Require(held.Length == size && held.All(b => b == 65)); Require(packet.Digest == Sha(Encoding.UTF8.GetBytes(f.Packet.ToJsonString()))); Require(packet.WitnessDigest == Sha(Encoding.UTF8.GetBytes(f.Packet["witness"]!.ToJsonString())));
            packet.Dispose(); Require(held.All(b => b == 0));
        }
        Action<JsonObject>[] invalid = {
            p => p["action"] = "run_target", p => p["command"] = "invented", p => p["witness"]!["source"] = "worktree",
            p => p["witness"]!["head"] = new string('0',40), p => p["witness"]!["indexMetadataSha256"] = "missing",
            p => p["witness"]!["rows"]![0]!["path"] = "../foreign", p => p["witness"]!["rows"]![0]!["path"] = "NUL.txt",
            p => p["witness"]!["rows"]![0]!["mode"] = "120000", p => p["witness"]!["rows"]![0]!["objectId"] = new string('c',40),
            p => p["witness"]!["rows"]![0]!["size"] = 25, p => p["witness"]!["rows"]![0]!["sha256"] = new string('c',64),
            p => p["files"]![0]!["path"] = "engine.mjs", p => p["files"]![0]!["contentBase64"] = "not-base64",
            p => p["files"]![0]!["contentBase64"] = Convert.ToBase64String(new byte[24]),
            p => p["files"]!.AsArray().Add(p["files"]![0]!.DeepClone()), p => p["witness"]!["rows"]![0]!["grant"] = true
        };
        foreach (var mutate in invalid) { var f = Fixture(24); mutate(f.Packet); Refuses(() => Read(f.Packet, f.Inputs).Dispose()); }
        var missing = Fixture(24); missing.Inputs.Clear(); Refuses(() => Read(missing.Packet, missing.Inputs).Dispose());
        var alias = Fixture(24); alias.Inputs.Add(".switchyard-index/unselected.js", (new string('c',64), 24)); Refuses(() => Read(alias.Packet, alias.Inputs).Dispose());
        var huge = Fixture(262145); Refuses(() => Read(huge.Packet, huge.Inputs).Dispose());
        var first = Fixture(262144); var second = Fixture(65536, name: "other.js");
        first.Packet["witness"]!["rows"]!.AsArray().Add(second.Packet["witness"]!["rows"]![0]!.DeepClone()); first.Packet["files"]!.AsArray().Add(second.Packet["files"]![0]!.DeepClone()); foreach (var pair in second.Inputs) first.Inputs.Add(pair.Key, pair.Value);
        using (var full = Read(first.Packet, first.Inputs)) Require(full.Files.Values.Sum(b => b.Length) == 327680);
        var over = Fixture(65537, name: "other.js"); first.Packet["witness"]!["rows"]![1] = over.Packet["witness"]!["rows"]![0]!.DeepClone(); first.Packet["files"]![1] = over.Packet["files"]![0]!.DeepClone(); first.Inputs[".switchyard-index/other.js"] = over.Inputs[".switchyard-index/other.js"]; Refuses(() => Read(first.Packet, first.Inputs).Dispose());
        // Literal Node JSON exercises UTF-8 paths and '+' in base64: .NET's
        // default JSON re-encoding must never replace the original raw hashes.
        using (var nodeDocument = JsonDocument.Parse("""{"schema":"switchyard-windows-index-bytes/v1","action":"shield_change_scan","witness":{"source":"git-index","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","indexMetadataSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","rows":[{"path":"src/café.js","mode":"100644","objectId":"1fad523268d827ec2f3413761c449f2cb4518087","size":5,"sha256":"47fe2fead14e4bc2fee6252c82badeffbd1fa586e5a72d0f0a2d900393afa620"}]},"files":[{"path":".switchyard-index/src/café.js","contentBase64":"8J+YigA="}]}"""))
        {
            var nodeInputs = new Dictionary<string, (string, int)>(StringComparer.Ordinal) { [".switchyard-index/src/café.js"] = ("47fe2fead14e4bc2fee6252c82badeffbd1fa586e5a72d0f0a2d900393afa620", 5) };
            var nodePacket = ReviewedIndexInputs.Read(nodeDocument.RootElement, nodeInputs); byte[] held = nodePacket.Files[".switchyard-index/src/café.js"];
            Require(nodePacket.Digest == "98da50e1d09370d3e5756a008f5ca50ee198c35364149150e40000e0622a4888"); Require(nodePacket.WitnessDigest == "f67641ad1b2fd214970d234bcfbdb90f135fb25ff0d59d8c22358f3d08ffc850"); Require(held.SequenceEqual(new byte[] { 240, 159, 152, 138, 0 }));
            nodePacket.Dispose(); Require(held.All(b => b == 0));
        }
        return checks;
    }
}
