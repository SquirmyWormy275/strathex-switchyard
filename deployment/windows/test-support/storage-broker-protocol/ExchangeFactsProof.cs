using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

internal static class ExchangeFactsProof
{
    internal static int Run()
    {
        int checks = 0; const string operation = "abcdef01-2345-4678-9abc-def012345678";
        byte[] image = JsonSerializer.SerializeToUtf8Bytes(new { schema = "switchyard-windows-broker-image/v1", operationId = operation, stagingIdentity = new { device = "1", inode = "10" }, imageIdentity = new { device = "1", inode = "11" }, mountIdentity = new { device = "1", inode = "12" }, imageSha256 = new string('a', 64), footerSha256 = new string('b', 64), virtualBytes = 67108864L, backingBytes = 67109376L });
        string volume = @"\\?\Volume{" + Guid.NewGuid().ToString("D") + @"}\";
        byte[] mount = JsonSerializer.SerializeToUtf8Bytes(new { schema = "switchyard-windows-broker-mount/v1", operationId = operation, volume });
        void Require(bool value) { if (!value) throw new InvalidOperationException("The exact protected exchange facts proof failed."); checks++; }
        void Refuses(Action action)
        {
            try { action(); } catch (Exception error) when (error is InvalidOperationException or JsonException or FormatException) { checks++; return; }
            throw new InvalidOperationException("Unfamiliar or damaged exchange facts were accepted.");
        }
        Require(WindowsStorageBrokerExchangeFacts.Image(image, operation).GetProperty("operationId").GetString() == operation);
        Require(WindowsStorageBrokerExchangeFacts.Mount(mount, operation) == volume);
        Refuses(() => WindowsStorageBrokerExchangeFacts.Image(image, Guid.NewGuid().ToString("D")));
        foreach (var change in new (string Name, JsonNode Value)[] { ("schema", JsonValue.Create("future")!), ("virtualBytes", JsonValue.Create(1L)!), ("backingBytes", JsonValue.Create(long.MaxValue)!), ("imageSha256", JsonValue.Create("unverified")!), ("footerSha256", JsonValue.Create("unverified")!), ("operationId", JsonValue.Create(Guid.NewGuid().ToString("D"))!), ("path", JsonValue.Create("C:\\foreign")!) })
        {
            var changed = JsonNode.Parse(image)!; changed[change.Name] = change.Value;
            Refuses(() => WindowsStorageBrokerExchangeFacts.Image(JsonSerializer.SerializeToUtf8Bytes(changed), operation));
        }
        foreach (var change in new[] { ("stagingIdentity", "inode", "11"), ("mountIdentity", "device", "2"), ("imageIdentity", "inode", "-1"), ("imageIdentity", "device", "0001") })
        {
            var changed = JsonNode.Parse(image)!; changed[change.Item1]![change.Item2] = change.Item3;
            Refuses(() => WindowsStorageBrokerExchangeFacts.Image(JsonSerializer.SerializeToUtf8Bytes(changed), operation));
        }
        string text = Encoding.UTF8.GetString(image);
        Refuses(() => WindowsStorageBrokerExchangeFacts.Image(Encoding.UTF8.GetBytes(text.Replace("\"schema\":", "\"schema\":\"duplicate\",\"schema\":", StringComparison.Ordinal)), operation));
        Refuses(() => WindowsStorageBrokerExchangeFacts.Image(new byte[8193], operation));
        Refuses(() => WindowsStorageBrokerExchangeFacts.Mount(mount, Guid.NewGuid().ToString("D")));
        foreach (string replacement in new[] { "C:\\foreign", @"\\?\Volume{00000000-0000-0000-0000-000000000000}\" })
        {
            var changed = JsonNode.Parse(mount)!; changed["volume"] = replacement;
            Refuses(() => WindowsStorageBrokerExchangeFacts.Mount(JsonSerializer.SerializeToUtf8Bytes(changed), operation));
        }
        var extra = JsonNode.Parse(mount)!; extra["approved"] = true; Refuses(() => WindowsStorageBrokerExchangeFacts.Mount(JsonSerializer.SerializeToUtf8Bytes(extra), operation));
        Refuses(() => WindowsStorageBrokerExchangeFacts.Image(image, operation.ToUpperInvariant()));
        var numeric = JsonNode.Parse(image)!; numeric["imageIdentity"]!["inode"] = 11; Refuses(() => WindowsStorageBrokerExchangeFacts.Image(JsonSerializer.SerializeToUtf8Bytes(numeric), operation));
        Refuses(() => WindowsStorageBrokerExchangeFacts.Image(new byte[] { 255, 255 }, operation));
        return checks;
    }
}
