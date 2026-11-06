using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Win32.SafeHandles;

// Fixed Windows Sandbox verbs only. The host owns authorization and durable VM
// identity; no caller can choose an executable, host command or arbitrary guest
// program. VM lifetime is deliberately separate from the short CLI process.
[SupportedOSPlatform("windows")]
internal static class WindowsSandboxCli
{
    private const string Schema = "switchyard-windows-sandbox-cli/v1";
    private const int MaximumInput = 262144, MaximumOutput = 65536;
    private sealed record Result(int ExitCode, string Output);
    [StructLayout(LayoutKind.Sequential)] private struct AttributeTag { public uint Attributes, Tag; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int informationClass, out AttributeTag information, uint size);
    private static Exception Invalid() => new InvalidOperationException("The closed Windows Sandbox CLI boundary did not verify.");
    private static void Exact(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != fields.Length || value.EnumerateObject().Any(p => !fields.Contains(p.Name, StringComparer.Ordinal))) throw Invalid();
    }
    private static string Id(JsonElement request)
    {
        string id = request.GetProperty("sandboxId").GetString() ?? "";
        if (!Guid.TryParseExact(id, "D", out var parsed) || parsed == Guid.Empty || id != parsed.ToString("D")) throw Invalid();
        return id;
    }
    private static bool SafeLocalPath(string value) => Regex.IsMatch(value, @"^[A-Za-z]:[\\/]", RegexOptions.CultureInvariant)
        && value.Length <= 2048 && !value[2..].Contains(':') && !value.Any(char.IsControl)
        && !value.Split('\\', '/').Skip(1).Any(part => part is "." or ".." || part.EndsWith(' ') || part.EndsWith('.'));
    private static string Catalog(JsonElement request)
    {
        string path = request.GetProperty("catalogRelativePath").GetString() ?? "";
        if (path.Length is < 1 or > 512 || path.Split('/').Length > 32 || path.Any(char.IsControl) || path.IndexOfAny(new[] { '\\', ':', '"', '<', '>', '|', '*', '?', '[', ']' }) >= 0
            || path.Split('/').Any(part => part.Length == 0 || part is "." or ".." || part.Equals(".git", StringComparison.OrdinalIgnoreCase) || part.EndsWith(' ') || part.EndsWith('.') || Regex.IsMatch(part, @"^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))) throw Invalid();
        return path.Replace('/', '\\');
    }
    private static string Configuration(JsonElement request, out string exchangeRoot)
    {
        string text = request.GetProperty("configuration").GetString() ?? "", digest = request.GetProperty("configurationSha256").GetString() ?? "";
        if (Encoding.UTF8.GetByteCount(text) > 16384 || !Regex.IsMatch(digest, "^[a-f0-9]{64}$") || Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant() != digest) throw Invalid();
        using var xml = XmlReader.Create(new StringReader(text), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 65536 });
        var root = XDocument.Load(xml).Root ?? throw Invalid();
        string[] fields = { "VGpu", "Networking", "AudioInput", "VideoInput", "PrinterRedirection", "ClipboardRedirection", "ProtectedClient", "MemoryInMB", "MappedFolders" };
        if (root.Name != "Configuration" || root.HasAttributes || root.Elements().Count() != fields.Length || root.Elements().Any(e => !fields.Contains(e.Name.LocalName, StringComparer.Ordinal) || e.Name.NamespaceName.Length != 0 || e.HasAttributes)) throw Invalid();
        foreach (string field in fields.Where(f => f is not "MappedFolders" and not "MemoryInMB"))
            if (root.Elements(field).Count() != 1 || root.Element(field)!.HasElements || root.Element(field)!.Value != (field == "ProtectedClient" ? "Enable" : "Disable")) throw Invalid();
        if (root.Elements("MemoryInMB").Count() != 1 || root.Element("MemoryInMB")!.HasElements || root.Element("MemoryInMB")!.Value is not "2048" and not "4096") throw Invalid();
        var mappings = root.Element("MappedFolders") ?? throw Invalid();
        if (root.Elements("MappedFolders").Count() != 1 || mappings.Elements().Count() != 3) throw Invalid();
        var expected = new Dictionary<string, string>(StringComparer.Ordinal) { [@"C:\B122\input"] = "true", [@"C:\B122\tools"] = "true", [@"C:\B122\exchange"] = "false" };
        exchangeRoot = "";
        var seen = new HashSet<string>(StringComparer.Ordinal); var hosts = new List<string>();
        foreach (var mapping in mappings.Elements())
        {
            string[] names = { "HostFolder", "SandboxFolder", "ReadOnly" };
            if (mapping.Name != "MappedFolder" || mapping.HasAttributes || mapping.Elements().Count() != 3 || mapping.Elements().Any(e => !names.Contains(e.Name.LocalName, StringComparer.Ordinal) || e.Name.NamespaceName.Length != 0 || e.HasElements || e.HasAttributes) || names.Any(name => mapping.Elements(name).Count() != 1)) throw Invalid();
            string guest = mapping.Element("SandboxFolder")!.Value, host = mapping.Element("HostFolder")!.Value;
            if (!seen.Add(guest) || !expected.TryGetValue(guest, out var readOnly) || mapping.Element("ReadOnly")!.Value != readOnly || !SafeLocalPath(host) || !Directory.Exists(host)) throw Invalid();
            string full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(host));
            if (hosts.Any(other => full.Equals(other, StringComparison.OrdinalIgnoreCase) || full.StartsWith(other + "\\", StringComparison.OrdinalIgnoreCase) || other.StartsWith(full + "\\", StringComparison.OrdinalIgnoreCase))) throw Invalid();
            hosts.Add(full); if (guest == @"C:\B122\exchange") exchangeRoot = full;
        }
        return text;
    }
    private static SafeFileHandle? PinAlias(out string alias)
    {
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.DoNotVerify);
        alias = Path.Combine(local, "Microsoft", "WindowsApps", "wsb.exe");
        if (!SafeLocalPath(alias)) return null;
        // An AppExecLink is intentional here; ordinary executables and arbitrary
        // symbolic links in the current directory or PATH are never candidates.
        var handle = CreateFileW(alias, 0x80, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
        if (handle.IsInvalid || !GetFileInformationByHandleEx(handle, 9, out var tag, 8) || tag.Tag != 0x8000001b || (tag.Attributes & 0x400) == 0) { handle.Dispose(); return null; }
        return handle;
    }
    private static async Task<string> Bounded(Stream stream)
    {
        using var memory = new MemoryStream(); var bytes = new byte[4096];
        for (;;) { int count = await stream.ReadAsync(bytes); if (count == 0) break; if (memory.Length + count > MaximumOutput) throw Invalid(); memory.Write(bytes, 0, count); }
        return new UTF8Encoding(false, true).GetString(memory.ToArray());
    }
    private static async Task<Result> Invoke(string executable, string[] arguments, int timeout)
    {
        var start = new ProcessStartInfo { FileName = executable, UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.Windows), RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        start.Environment.Clear(); string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        start.Environment["SystemRoot"] = windows; start.Environment["WINDIR"] = windows;
        start.Environment["LOCALAPPDATA"] = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        start.Environment["USERPROFILE"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        start.Environment["PATH"] = Path.Combine(windows, "System32");
        using var process = Process.Start(start) ?? throw Invalid();
        try
        {
            var output = Bounded(process.StandardOutput.BaseStream); var errors = Bounded(process.StandardError.BaseStream);
            await Task.WhenAll(output, errors, process.WaitForExitAsync()).WaitAsync(TimeSpan.FromMilliseconds(timeout));
            return new Result(process.ExitCode, await output);
        }
        finally { try { if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); } } catch { } }
    }
    private static async Task<string[]> List(string alias)
    {
        var result = await Invoke(alias, new[] { "list", "--raw" }, 30000); if (result.ExitCode != 0) throw Invalid();
        using var document = JsonDocument.Parse(result.Output); var value = document.RootElement;
        if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("WindowsSandboxEnvironments", out var list) || list.ValueKind != JsonValueKind.Array || list.GetArrayLength() > 64) throw Invalid();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in list.EnumerateArray())
        {
            string raw = entry.GetProperty("Id").GetString() ?? "";
            if (!Guid.TryParseExact(raw, "D", out var id) || id == Guid.Empty || !ids.Add(id.ToString("D"))) throw Invalid();
        }
        return ids.OrderBy(id => id, StringComparer.Ordinal).ToArray();
    }
    private static void Write(object value) => Console.WriteLine(JsonSerializer.Serialize(value));
    private static async Task<int> Execute()
    {
        PipeTextProtocol.Configure();
        var chars = new char[MaximumInput + 1]; int count = 0;
        while (count < chars.Length) { int read = await Console.In.ReadAsync(chars.AsMemory(count)); if (read == 0) break; count += read; }
        if (count > MaximumInput) throw Invalid(); using var document = JsonDocument.Parse(new string(chars, 0, count)); var request = document.RootElement;
        string action = request.GetProperty("action").GetString() ?? "";
        string[] fields = action switch { "metadata" or "list" => new[] { "schema", "action" }, "start" => new[] { "schema", "action", "sandboxId", "configuration", "configurationSha256", "exchangeBinding" }, "validate-config" => new[] { "schema", "action", "configuration", "configurationSha256", "exchangeBinding" }, "stop" or "connect" or "probe-login" => new[] { "schema", "action", "sandboxId" }, "execute" => new[] { "schema", "action", "sandboxId", "catalogRelativePath", "timeoutMs" }, _ => throw Invalid() };
        Exact(request, fields); if (request.GetProperty("schema").GetString() != Schema) throw Invalid();
        string? configuration = null; string exchangeRoot = "";
        if (action is "start" or "validate-config") configuration = Configuration(request, out exchangeRoot);
        using var mapping = action is "start" or "validate-config" ? ReviewedInputStager.PinBoundedMapping(request.GetProperty("exchangeBinding"), exchangeRoot) : null;
        if (action == "validate-config") { Write(new { schema = Schema, action, status = "validated", configurationSha256 = request.GetProperty("configurationSha256").GetString(), exchangeQuotaEnforced = true, sandboxEnforced = false, effectStarted = false }); return 0; }
        using var pinned = PinAlias(out var alias);
        if (action == "metadata")
        {
            var storage = ReviewedInputStager.StoragePrerequisites();
            if (pinned is null) Write(new { schema = Schema, action, status = "unavailable", reason = "The current-user Windows Sandbox AppExecLink is unavailable.", storage, effectStarted = false });
            else Write(new { schema = Schema, action, status = "available", aliasType = "current-user-AppExecLink", storage, effectStarted = false });
            return 0;
        }
        if (pinned is null) { Write(new { schema = Schema, action, status = "unavailable", reason = "The current-user Windows Sandbox AppExecLink is unavailable; no ordinary executable or legacy viewer was substituted.", effectStarted = false }); return 0; }
        if (action == "list") { Write(new { schema = Schema, action, status = "observed", ids = await List(alias), effectStarted = false }); return 0; }
        string sandboxId = Id(request);
        var before = await List(alias);
        if (action == "start")
        {
            if (before.Length != 0) { Write(new { schema = Schema, action, status = "blocked", effectStarted = false }); return 0; }
            var launched = await Invoke(alias, new[] { "start", "--id", sandboxId, "--config", configuration!, "--raw" }, 45000);
            var after = await List(alias);
            bool verified = launched.ExitCode == 0 && after.Length == 1 && after[0] == sandboxId;
            Write(new { schema = Schema, action, status = verified ? "started" : "outcome-unconfirmed", sandboxId, configurationSha256 = request.GetProperty("configurationSha256").GetString(), effectStarted = true }); return 0;
        }
        if (action == "stop")
        {
            if (before.Contains(sandboxId, StringComparer.Ordinal)) await Invoke(alias, new[] { "stop", "--id", sandboxId, "--raw" }, 30000);
            bool absent = !(await List(alias)).Contains(sandboxId, StringComparer.Ordinal);
            Write(new { schema = Schema, action, status = absent ? "stopped" : "outcome-unconfirmed", sandboxId, absentObserved = absent, effectStarted = before.Contains(sandboxId, StringComparer.Ordinal) }); return 0;
        }
        if (!before.Contains(sandboxId, StringComparer.Ordinal)) { Write(new { schema = Schema, action, status = "absent", sandboxId, effectStarted = false }); return 0; }
        if (action == "connect")
        {
            var result = await Invoke(alias, new[] { "connect", "--id", sandboxId, "--raw" }, 30000);
            Write(new { schema = Schema, action, status = result.ExitCode == 0 ? "connection-requested" : "outcome-unconfirmed", sandboxId, effectStarted = true }); return 0;
        }
        string command; int timeout;
        if (action == "probe-login") { command = @"C:\Windows\System32\whoami.exe"; timeout = 10000; }
        else
        {
            string catalog = Catalog(request); timeout = request.GetProperty("timeoutMs").GetInt32(); if (timeout is < 1000 or > 600000) throw Invalid();
            command = $"\"C:\\B122\\tools\\b122-sandbox-worker.exe\" --catalog \"C:\\B122\\input\\{catalog}\" --request \"C:\\B122\\exchange\\request.json\" --output \"C:\\B122\\exchange\"";
        }
        var executed = await Invoke(alias, new[] { "exec", "--id", sandboxId, "--run-as", "ExistingLogin", "--command", command, "--raw" }, timeout);
        long? guestExitCode = null;
        if (executed.ExitCode == 0) { using var value = JsonDocument.Parse(executed.Output); if (value.RootElement.TryGetProperty("ExitCode", out var code) && code.TryGetInt64(out long exit) && exit >= int.MinValue && exit <= uint.MaxValue) guestExitCode = exit < 0 ? exit + 0x100000000L : exit; }
        Write(new { schema = Schema, action, status = guestExitCode.HasValue ? "executed" : "dispatch-unconfirmed", sandboxId, guestExitCode, effectStarted = true }); return 0;
    }
    public static int Run()
    {
        try { return Execute().GetAwaiter().GetResult(); }
        catch { Console.Error.WriteLine("The fixed Windows Sandbox CLI operation did not verify; retain its exact ownership and do not replay it."); return 2; }
    }
}
