using System.Security.Cryptography;
using System.Text.Json;

internal static partial class ReviewedInputStager
{
    internal static JsonElement CreateBrokerImage(WindowsStorageBrokerInstallation.Settings settings, string operationId)
    {
        if (WindowsStorageBrokerFiles.CurrentOwnerSid() != "S-1-5-18" || !Guid.TryParseExact(operationId, "D", out var operation) || operation == Guid.Empty) throw Invalid();
        var files = new WindowsStorageBrokerExchangeFiles(settings);
        using var installation = WindowsStorageBrokerFiles.PinDirectory(settings.Root, settings.ClientSid);
        using var exchange = WindowsStorageBrokerFiles.PinDirectory(files.Root, settings.ClientSid);
        using var owner = WindowsStorageBrokerFiles.PinDirectory(files.OperationRoot(operationId), settings.ClientSid);
        string root = files.DiskRoot(operationId), imagePath = Path.Combine(root, "exchange.vhd");
        using var directory = WindowsStorageBrokerFiles.CreateDirectory(root, settings.ClientSid); var original = Information(directory, true);
        object mountIdentity;
        using (var mount = WindowsStorageBrokerFiles.CreateDirectory(Path.Combine(root, "mount"), settings.ClientSid)) mountIdentity = Identity(Information(mount, true));
        FileInformation created; string footerSha256, imageSha256;
        using (var image = new FileStream(WindowsStorageBrokerFiles.CreateDataFile(imagePath, settings.ClientSid), FileAccess.ReadWrite))
        {
            created = Information(image.SafeFileHandle, false); if (created.Links != 1) throw Invalid();
            BoundedExchangeImage.WriteNew(image, operation); image.Flush(flushToDisk: true);
            footerSha256 = BoundedExchangeImage.Validate(image, operation); image.Position = 0; imageSha256 = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
        }
        using var pinned = Open(imagePath, false); var current = Information(pinned, false);
        if (current.Volume != created.Volume || current.IndexHigh != created.IndexHigh || current.IndexLow != created.IndexLow || current.Links != 1
            || !Directory.EnumerateFileSystemEntries(root).Select(Path.GetFileName).Order(StringComparer.Ordinal).SequenceEqual(new[] { "exchange.vhd", "mount" })) throw Invalid();
        BoundedExchangeImage.ReadNativeHeader(imagePath, operation);
        return JsonSerializer.SerializeToElement(new { schema = "switchyard-windows-broker-image/v1", operationId, stagingIdentity = Identity(original), imageIdentity = Identity(created), mountIdentity, imageSha256, footerSha256, virtualBytes = BoundedExchangeImage.VirtualBytes, backingBytes = BoundedExchangeImage.BackingBytes });
    }
    internal static void VerifyBrokerImage(WindowsStorageBrokerInstallation.Settings settings, JsonElement proof, bool initial)
    {
        Exact(proof, "schema", "operationId", "stagingIdentity", "imageIdentity", "mountIdentity", "imageSha256", "footerSha256", "virtualBytes", "backingBytes");
        if (WindowsStorageBrokerFiles.CurrentOwnerSid() != "S-1-5-18" || proof.GetProperty("schema").GetString() != "switchyard-windows-broker-image/v1" || !Guid.TryParseExact(proof.GetProperty("operationId").GetString(), "D", out var operation) || operation == Guid.Empty
            || proof.GetProperty("virtualBytes").GetInt64() != BoundedExchangeImage.VirtualBytes || proof.GetProperty("backingBytes").GetInt64() != BoundedExchangeImage.BackingBytes || !Digest.IsMatch(proof.GetProperty("imageSha256").GetString() ?? "") || !Digest.IsMatch(proof.GetProperty("footerSha256").GetString() ?? "")) throw Invalid();
        var files = new WindowsStorageBrokerExchangeFiles(settings); string root = files.DiskRoot(operation.ToString("D"));
        using var installation = WindowsStorageBrokerFiles.PinDirectory(settings.Root, settings.ClientSid);
        using var exchange = WindowsStorageBrokerFiles.PinDirectory(files.Root, settings.ClientSid);
        using var owner = WindowsStorageBrokerFiles.PinDirectory(files.OperationRoot(operation.ToString("D")), settings.ClientSid);
        using var directory = WindowsStorageBrokerFiles.PinDirectory(root, settings.ClientSid);
        if (!Matches(Information(directory, true), proof.GetProperty("stagingIdentity"))) throw Invalid();
        if (!Directory.EnumerateFileSystemEntries(root).Select(Path.GetFileName).Order(StringComparer.Ordinal).SequenceEqual(new[] { "exchange.vhd", "mount" })) throw Invalid();
        using var image = new FileStream(Open(Path.Combine(root, "exchange.vhd"), false), FileAccess.Read); var observed = Information(image.SafeFileHandle, false);
        if (!Matches(observed, proof.GetProperty("imageIdentity")) || observed.Links != 1 || BoundedExchangeImage.Validate(image, operation) != proof.GetProperty("footerSha256").GetString()) throw Invalid();
        if (initial) { image.Position = 0; if (Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant() != proof.GetProperty("imageSha256").GetString()) throw Invalid(); }
    }
    internal static void RetireBrokerImage(WindowsStorageBrokerInstallation.Settings settings, JsonElement proof)
    {
        VerifyBrokerImage(settings, proof, false);
        string operationId = proof.GetProperty("operationId").GetString() ?? throw Invalid();
        var files = new WindowsStorageBrokerExchangeFiles(settings); string root = files.DiskRoot(operationId), mountPath = Path.Combine(root, "mount"), imagePath = Path.Combine(root, "exchange.vhd");
        using var installation = WindowsStorageBrokerFiles.PinDirectory(settings.Root, settings.ClientSid);
        using var exchange = WindowsStorageBrokerFiles.PinDirectory(files.Root, settings.ClientSid);
        using var owner = WindowsStorageBrokerFiles.PinDirectory(files.OperationRoot(operationId), settings.ClientSid);
        using (var directory = WindowsStorageBrokerFiles.PinDirectory(root, settings.ClientSid))
        {
            if (!Matches(Information(directory, true), proof.GetProperty("stagingIdentity"))) throw Invalid();
            using (var mount = WindowsStorageBrokerFiles.PinDirectory(mountPath, settings.ClientSid))
                if (!Matches(Information(mount, true), proof.GetProperty("mountIdentity")) || Directory.EnumerateFileSystemEntries(mountPath).Any()) throw Invalid();
            BoundedExchangeImage.ReadNativeHeader(imagePath, Guid.ParseExact(operationId, "D"));
            using (var image = Open(imagePath, false)) if (!Matches(Information(image, false), proof.GetProperty("imageIdentity")) || Information(image, false).Links != 1) throw Invalid();
            File.Delete(imagePath); Directory.Delete(mountPath);
            if (Directory.EnumerateFileSystemEntries(root).Any()) throw Invalid();
        }
        Directory.Delete(root);
    }
}
