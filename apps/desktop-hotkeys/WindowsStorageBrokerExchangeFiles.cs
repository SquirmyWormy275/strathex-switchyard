using System.Runtime.Versioning;
using System.Text.RegularExpressions;

// Paths are derived exclusively from the verified installation and UUID.
// Records are immutable, exclusively created, flushed and read back through
// the protected-file boundary. Partial and unfamiliar state is never removed.
[SupportedOSPlatform("windows")]
internal sealed class WindowsStorageBrokerExchangeFiles(WindowsStorageBrokerInstallation.Settings settings)
{
    internal const string DirectoryName = "exchange";
    internal const int MaximumOperations = 64;
    private static Exception Invalid() => new InvalidOperationException("Preserve the original protected exchange files and their exact inventory.");
    internal string Root => Path.Combine(settings.Root, DirectoryName);
    internal string OperationRoot(string operationId)
    {
        if (!Guid.TryParseExact(operationId, "D", out var operation) || operation == Guid.Empty || operation.ToString("D") != operationId) throw Invalid();
        return Path.Combine(Root, operationId);
    }
    internal string DiskRoot(string operationId) => Path.Combine(OperationRoot(operationId), "disk-" + operationId);
    private static bool Present(string path)
    {
        try { _ = File.GetAttributes(path); return true; }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
    }
    private void SystemOnly()
    {
        if (WindowsStorageBrokerFiles.CurrentOwnerSid() != "S-1-5-18") throw Invalid();
    }
    private string[] Operations()
    {
        using var parent = WindowsStorageBrokerFiles.PinDirectory(settings.Root, settings.ClientSid);
        if (!Present(Root)) return [];
        using var root = WindowsStorageBrokerFiles.PinDirectory(Root, settings.ClientSid);
        string[] names = Directory.EnumerateFileSystemEntries(Root).Select(path => Path.GetFileName(path) ?? throw Invalid()).Order(StringComparer.Ordinal).ToArray();
        if (names.Length > MaximumOperations || names.Any(name => !Guid.TryParseExact(name, "D", out var id) || id == Guid.Empty || id.ToString("D") != name)) throw Invalid();
        foreach (string name in names) using (WindowsStorageBrokerFiles.PinDirectory(OperationRoot(name), settings.ClientSid)) { }
        return names;
    }
    internal IReadOnlyList<byte[]> Read(string operationId)
    {
        string operation = OperationRoot(operationId); string[] known = Operations(); if (!known.Contains(operationId, StringComparer.Ordinal)) return [];
        using var parent = WindowsStorageBrokerFiles.PinDirectory(Root, settings.ClientSid);
        using var directory = WindowsStorageBrokerFiles.PinDirectory(operation, settings.ClientSid);
        string[] entries = Directory.EnumerateFileSystemEntries(operation).Select(path => Path.GetFileName(path) ?? throw Invalid()).Order(StringComparer.Ordinal).ToArray();
        string[] records = entries.Where(name => name != "disk-" + operationId).ToArray();
        if (records.Length > WindowsStorageBrokerExchangeJournal.MaximumEvents || records.Where((name, index) => !Regex.IsMatch(name, "^[0-9]{4}\\.json$", RegexOptions.CultureInvariant) || name != index.ToString("D4", System.Globalization.CultureInfo.InvariantCulture) + ".json").Any()) throw Invalid();
        return records.Select(name => WindowsStorageBrokerFiles.ReadFile(Path.Combine(operation, name), settings.ClientSid, 8192)).ToArray();
    }
    internal void Append(string operationId, int sequence, byte[] bytes)
    {
        SystemOnly(); string operation = OperationRoot(operationId);
        if (sequence is < 0 or >= WindowsStorageBrokerExchangeJournal.MaximumEvents || bytes.Length is < 2 or > 8192) throw Invalid();
        using var installation = WindowsStorageBrokerFiles.PinDirectory(settings.Root, settings.ClientSid);
        if (!Present(Root)) { if (sequence != 0) throw Invalid(); using var created = WindowsStorageBrokerFiles.CreateDirectory(Root, settings.ClientSid); }
        using var root = WindowsStorageBrokerFiles.PinDirectory(Root, settings.ClientSid);
        string[] known = Operations();
        if (!known.Contains(operationId, StringComparer.Ordinal))
        {
            if (sequence != 0 || known.Length >= MaximumOperations) throw Invalid();
            using var created = WindowsStorageBrokerFiles.CreateDirectory(operation, settings.ClientSid);
        }
        using var directory = WindowsStorageBrokerFiles.PinDirectory(operation, settings.ClientSid);
        if (Read(operationId).Count != sequence) throw Invalid();
        string path = Path.Combine(operation, sequence.ToString("D4", System.Globalization.CultureInfo.InvariantCulture) + ".json");
        WindowsStorageBrokerFiles.CreateFile(path, settings.ClientSid, bytes);
        if (!WindowsStorageBrokerFiles.ReadFile(path, settings.ClientSid, 8192).AsSpan().SequenceEqual(bytes)) throw Invalid();
    }
    internal WindowsStorageBrokerExchangeJournal Journal() => new(settings.Binding, Read, Append);
}
