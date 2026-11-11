using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;

// Invoke only the pure descriptor parser. No Windows filesystem API is called.
internal static class ScannerRecipeProof
{
    internal static int Run()
    {
#pragma warning disable CA1416
        var parser = typeof(ReviewedInputStager).GetMethod("ScannerControls", BindingFlags.NonPublic | BindingFlags.Static)
            ?? throw new InvalidOperationException("Original scanner descriptor parser missing.");
#pragma warning restore CA1416
        int checks = 0;
        JsonObject File(string name) => new() { ["path"] = name, ["sha256"] = new string('a', 64), ["size"] = 12,
            ["identity"] = new JsonObject { ["device"] = "1", ["inode"] = "2" } };
        JsonArray Files(params string[] names) => new(names.Select(name => (JsonNode)File(name)).ToArray());
        int Read(JsonArray files, bool complete = true)
        {
            using var value = JsonDocument.Parse(files.ToJsonString());
            return ((Array)parser.Invoke(null, new object[] { value.RootElement, complete })!).Length;
        }
        void Require(bool value) { if (!value) throw new InvalidOperationException("Scanner descriptor proof failed."); checks++; }
        void Refuses(JsonArray files, bool complete = true)
        {
            try { Read(files, complete); }
            catch (TargetInvocationException error) when (error.InnerException is InvalidOperationException) { checks++; return; }
            throw new InvalidOperationException("An invalid scanner descriptor set was accepted.");
        }
        string[] basic = { "engine.mjs", "scanner.json", "request.json", "recipe.json" };
        foreach (var optional in new[] { Array.Empty<string>(), new[] { "advisory.json" }, new[] { "catalog.json" }, new[] { "advisory.json", "catalog.json" } })
            Require(Read(Files(basic.Concat(optional).ToArray())) == 4 + optional.Length);
        Require(Read(Files("engine.mjs", "scanner.json", "advisory.json", "request.json", "catalog.json"), false) == 5);
        Refuses(Files(basic.Concat(new[] { "advisory.json", "catalog.json" }).ToArray()), false);
        Refuses(Files(basic.Concat(new[] { "advisory.json", "catalog.json", "unreviewed.json" }).ToArray()));
        Refuses(Files("engine.mjs", "scanner.json", "request.json", "catalog.json"));
        Refuses(Files(basic.Concat(new[] { "catalog.json", "catalog.json" }).ToArray()));
        foreach (string name in new[] { "../catalog.json", "CATALOG.JSON", "sub/catalog.json", "run.exe", "catalog.json:stream" })
            Refuses(Files(basic.Concat(new[] { name }).ToArray()));
        foreach (int size in new[] { 0, 327681 }) { var files = Files(basic.Concat(new[] { "catalog.json" }).ToArray()); files[4]!["size"] = size; Refuses(files); }
        var extra = Files(basic); extra[0]!["approved"] = true; Refuses(extra);
        var invalidIdentity = Files(basic); invalidIdentity[0]!["identity"]!["inode"] = "-1"; Refuses(invalidIdentity);
        return checks;
    }
}
