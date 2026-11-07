using System.Text.Json;
using System.Text.Json.Nodes;

internal static class StateLockFailureEvidence
{
    // Diagnostic only. No native messages, private paths or lease authority.
    internal static object? Read(JsonElement owner)
    {
        if (owner.ValueKind != JsonValueKind.Object || !owner.TryGetProperty("stateLockFailure", out var item) || item.ValueKind != JsonValueKind.Object) return null;
        string[] keys = { "schema", "kind", "phase", "progress", "exitCode", "signal", "spawnCode" };
        if (!item.EnumerateObject().Select(p => p.Name).Order().SequenceEqual(keys.Order())) return null;
        string? Label(string name, params string[] allowed) => item.GetProperty(name).ValueKind == JsonValueKind.String && item.GetProperty(name).GetString() is string text && allowed.Contains(text) ? text : null;
        if (Label("schema", "switchyard-state-lock-failure/v1") == null) return null;
        string? kind = Label("kind", "timeout", "child-exit", "spawn-error", "input-error", "invalid-reply", "output-bound", "not-live");
        string? phase = Label("phase", "worker-startup", "lease-acquire", "lease-release");
        string? progress = Label("progress", "not-observed", "lease-entered", "lease-input-read", "lease-request-read", "lease-parent-open-denied", "lease-parent-open-failed", "lease-parent-opened", "lease-parent-query-denied", "lease-parent-query-failed", "lease-parent-birth-read", "lease-owner-found", "lease-owner-pipe-bound");
        string? signal = Label("signal", "SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV", "SIGILL", "SIGBUS", "SIGINT", "other");
        string? spawnCode = Label("spawnCode", "ENOENT", "EACCES", "EPERM", "EINVAL", "ENOMEM", "EAGAIN", "other");
        if (kind == null || phase == null || progress == null || signal == null && item.GetProperty("signal").ValueKind != JsonValueKind.Null || spawnCode == null && item.GetProperty("spawnCode").ValueKind != JsonValueKind.Null) return null;
        long? exitCode = null;
        var code = item.GetProperty("exitCode");
        if (code.ValueKind != JsonValueKind.Null)
        {
            if (code.ValueKind != JsonValueKind.Number || !code.TryGetInt64(out long value) || value < int.MinValue || value > uint.MaxValue) return null;
            exitCode = value;
        }
        return new { schema = "switchyard-state-lock-failure/v1", kind, phase, progress, exitCode, signal, spawnCode };
    }

    internal static int VerifyParser()
    {
        int checks = 0;
        const string valid = """{"stateLockFailure":{"schema":"switchyard-state-lock-failure/v1","kind":"child-exit","phase":"worker-startup","progress":"not-observed","exitCode":3221225794,"signal":null,"spawnCode":null}}""";
        void Check(string json, bool accepted)
        {
            using var doc = JsonDocument.Parse(json);
            if ((Read(doc.RootElement) != null) != accepted) throw new InvalidOperationException("State lock failure projection proof failed.");
            checks++;
        }
        Check(valid, true);
        foreach (string json in new[] { "null", "[]", "{}", "{\"stateLockFailure\":null}", "{\"stateLockFailure\":[]}" }) Check(json, false);
        var source = JsonNode.Parse(valid)!.AsObject();
        foreach (string progress in new[] { "lease-entered", "lease-input-read", "lease-request-read", "lease-parent-open-denied", "lease-parent-open-failed", "lease-parent-opened", "lease-parent-query-denied", "lease-parent-query-failed", "lease-parent-birth-read", "lease-owner-found", "lease-owner-pipe-bound" })
        {
            var changed = source.DeepClone(); changed["stateLockFailure"]!["progress"] = progress;
            using var doc = JsonDocument.Parse(changed.ToJsonString());
            var projected = JsonSerializer.SerializeToElement(Read(doc.RootElement));
            if (projected.ValueKind != JsonValueKind.Object || projected.GetProperty("progress").GetString() != progress
                || projected.GetProperty("kind").GetString() != "child-exit" || projected.GetProperty("exitCode").GetInt64() != 3221225794) throw new InvalidOperationException("State lock progress projection proof failed.");
            checks++;
        }
        foreach (string name in new[] { "schema", "kind", "phase", "progress", "signal", "spawnCode", "exitCode" })
        {
            var changed = source.DeepClone(); changed["stateLockFailure"]![name] = "PRIVATE_CONTENT"; Check(changed.ToJsonString(), false);
            changed = source.DeepClone(); changed["stateLockFailure"]!.AsObject().Remove(name); Check(changed.ToJsonString(), false);
        }
        foreach (long value in new[] { (long)int.MinValue, (long)uint.MaxValue, 0L })
        {
            var changed = source.DeepClone(); changed["stateLockFailure"]!["exitCode"] = value; Check(changed.ToJsonString(), true);
        }
        foreach (long value in new[] { (long)int.MinValue - 1, (long)uint.MaxValue + 1 })
        {
            var changed = source.DeepClone(); changed["stateLockFailure"]!["exitCode"] = value; Check(changed.ToJsonString(), false);
        }
        var extra = source.DeepClone(); extra["stateLockFailure"]!["raw"] = "PRIVATE_CONTENT"; Check(extra.ToJsonString(), false);
        Check(valid.Replace("\"kind\":", "\"kind\":\"timeout\",\"kind\":"), false);
        Check(valid.Replace("3221225794", "0.5"), false);
        Check(valid.Replace("3221225794", "null"), true);
        return checks;
    }
}
