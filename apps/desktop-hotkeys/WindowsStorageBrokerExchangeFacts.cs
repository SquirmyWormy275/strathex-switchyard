using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

// Protected storage establishes provenance; this parser separately rejects
// damaged, aliased and unfamiliar facts before native use or journal removal.
internal static class WindowsStorageBrokerExchangeFacts
{
    private static Exception Invalid() => new InvalidOperationException("The original bounded exchange facts did not verify; preserve them.");
    private static void Exact(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw Invalid(); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject()) if (!names.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name)) throw Invalid();
        if (seen.Count != names.Length) throw Invalid();
    }
    private static void Operation(string value)
    {
        if (!Guid.TryParseExact(value, "D", out var operation) || operation == Guid.Empty || operation.ToString("D") != value) throw Invalid();
    }
    private static JsonDocument Parse(byte[] bytes)
    {
        if (bytes.Length is < 2 or > 8192) throw Invalid(); return JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
    }
    private static (string Device, string Inode) Identity(JsonElement value)
    {
        Exact(value, "device", "inode"); string device = value.GetProperty("device").GetString() ?? "", inode = value.GetProperty("inode").GetString() ?? "";
        if (!uint.TryParse(device, NumberStyles.None, CultureInfo.InvariantCulture, out uint volume) || volume.ToString(CultureInfo.InvariantCulture) != device
            || !ulong.TryParse(inode, NumberStyles.None, CultureInfo.InvariantCulture, out ulong file) || file == 0 || file.ToString(CultureInfo.InvariantCulture) != inode) throw Invalid();
        return (device, inode);
    }
    internal static JsonElement Image(byte[] bytes, string operationId)
    {
        Operation(operationId); using var json = Parse(bytes); var value = json.RootElement;
        Exact(value, "schema", "operationId", "stagingIdentity", "imageIdentity", "mountIdentity", "imageSha256", "footerSha256", "virtualBytes", "backingBytes");
        if (value.GetProperty("schema").GetString() != "switchyard-windows-broker-image/v1" || value.GetProperty("operationId").GetString() != operationId
            || value.GetProperty("virtualBytes").GetInt64() != WindowsStorageBrokerExchangeProtocol.VirtualBytes || value.GetProperty("backingBytes").GetInt64() != WindowsStorageBrokerExchangeProtocol.BackingBytes
            || !Regex.IsMatch(value.GetProperty("imageSha256").GetString() ?? "", "^[a-f0-9]{64}$", RegexOptions.CultureInvariant)
            || !Regex.IsMatch(value.GetProperty("footerSha256").GetString() ?? "", "^[a-f0-9]{64}$", RegexOptions.CultureInvariant)) throw Invalid();
        var stage = Identity(value.GetProperty("stagingIdentity")); var image = Identity(value.GetProperty("imageIdentity")); var mount = Identity(value.GetProperty("mountIdentity"));
        if (stage.Device != image.Device || stage.Device != mount.Device || new[] { stage.Inode, image.Inode, mount.Inode }.Distinct(StringComparer.Ordinal).Count() != 3) throw Invalid();
        return value.Clone();
    }
    internal static string Mount(byte[] bytes, string operationId)
    {
        Operation(operationId); using var json = Parse(bytes); var value = json.RootElement; Exact(value, "schema", "operationId", "volume");
        string volume = value.GetProperty("volume").GetString() ?? "";
        if (value.GetProperty("schema").GetString() != "switchyard-windows-broker-mount/v1" || value.GetProperty("operationId").GetString() != operationId
            || volume.Length != 49 || !volume.StartsWith(@"\\?\Volume{", StringComparison.OrdinalIgnoreCase) || !volume.EndsWith(@"}\", StringComparison.Ordinal)
            || !Guid.TryParseExact(volume.Substring(11, 36), "D", out var id) || id == Guid.Empty) throw Invalid();
        return volume;
    }
}
