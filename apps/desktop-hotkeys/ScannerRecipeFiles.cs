using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

// Fixed scanner-control filesystem operations. No shell, execution, ACL changes,
// overwrites, cleanup or automatic continuation after a missing acknowledgement.
[SupportedOSPlatform("windows")]
internal static partial class ReviewedInputStager
{
    private const string ScannerSaveSchema = "switchyard-windows-scanner-save/v1";
    private const int ScannerControlLimit = 320 * 1024;
    private static readonly HashSet<string> ScannerControlNames = new(StringComparer.Ordinal)
        { "engine.mjs", "scanner.json", "advisory.json", "request.json", "recipe.json", "catalog.json" };
    private sealed record ScannerControl(string Path, string Sha256, int Size, JsonElement? Identity);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectoryW(string path, IntPtr security);

    private static ScannerControl ScannerControlDescriptor(JsonElement value, bool owned, bool content = false)
    {
        Exact(value, new[] { "path", "sha256", "size" }.Concat(owned ? new[] { "identity" } : Array.Empty<string>()).Concat(content ? new[] { "contentBase64" } : Array.Empty<string>()).ToArray());
        string path = value.GetProperty("path").GetString() ?? throw Invalid(), sha = value.GetProperty("sha256").GetString() ?? throw Invalid();
        if (!ScannerControlNames.Contains(path) || !Digest.IsMatch(sha) || !value.GetProperty("size").TryGetInt32(out int size) || size is < 1 or > ScannerControlLimit) throw Invalid();
        if (owned)
        {
            var id = value.GetProperty("identity"); Exact(id, "device", "inode");
            foreach (string name in new[] { "device", "inode" })
                if (!ulong.TryParse(id.GetProperty(name).GetString(), NumberStyles.None, CultureInfo.InvariantCulture, out _)) throw Invalid();
        }
        return new ScannerControl(path, sha, size, owned ? value.GetProperty("identity") : null);
    }
    private static ScannerControl[] ScannerControls(JsonElement value, bool complete)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > (complete ? 6 : 5)) throw Invalid();
        var files = value.EnumerateArray().Select(file => ScannerControlDescriptor(file, owned: true)).ToArray();
        if (files.Select(file => file.Path).Distinct(StringComparer.Ordinal).Count() != files.Length) throw Invalid();
        if (complete && (files.Length is < 4 or > 6 || new[] { "engine.mjs", "scanner.json", "request.json", "recipe.json" }.Any(name => !files.Any(file => file.Path == name)))) throw Invalid();
        return files;
    }
    private static void ScannerDirectoryContents(string directory, IEnumerable<string> names)
    {
        var expected = names.Order(StringComparer.Ordinal).ToArray();
        var actual = new List<string>();
        foreach (string entry in Directory.EnumerateFileSystemEntries(directory))
        {
            if (actual.Count >= 6) throw Invalid(); actual.Add(Path.GetFileName(entry));
        }
        if (!actual.Order(StringComparer.Ordinal).SequenceEqual(expected, StringComparer.Ordinal)) throw Invalid();
    }
    private static FileInformation VerifyScannerControl(string root, ScannerControl file, List<FileStream> retained)
    {
        var stream = new FileStream(Open(Path.Combine(root, file.Path), false), FileAccess.Read);
        retained.Add(stream);
        var before = Information(stream.SafeFileHandle, false);
        if (before.Links != 1 || (((ulong)before.SizeHigh << 32) | before.SizeLow) != (ulong)file.Size || file.Identity.HasValue && !Matches(before, file.Identity.Value)) throw Invalid();
        var bytes = new byte[file.Size];
        try
        {
            stream.ReadExactly(bytes); if (stream.ReadByte() != -1 || Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != file.Sha256) throw Invalid();
            var after = Information(stream.SafeFileHandle, false);
            if (after.Links != 1 || before.SizeHigh != after.SizeHigh || before.SizeLow != after.SizeLow || before.Write.dwHighDateTime != after.Write.dwHighDateTime || before.Write.dwLowDateTime != after.Write.dwLowDateTime) throw Invalid();
            return after;
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public static int RunScannerSave()
    {
        var handles = new List<SafeFileHandle>(); var retained = new List<FileStream>(); byte[]? content = null;
        try
        {
            PipeTextProtocol.Configure(); var text = new StringBuilder(); int character;
            while ((character = Console.In.Read()) != -1 && character != '\n') { if (character == '\r' || text.Length >= 524288) throw Invalid(); text.Append((char)character); }
            string raw = text.ToString(); if (Encoding.UTF8.GetByteCount(raw) > 524288) throw Invalid();
            using var document = JsonDocument.Parse(raw); var request = document.RootElement;
            string operation = request.GetProperty("operation").GetString() ?? throw Invalid();
            var fields = new[] { "schema", "operationId", "operation", "repositoryRoot", "rootIdentity" };
            Exact(request, operation switch
            {
                "create-directory" => fields,
                "write-file" => fields.Concat(new[] { "directoryIdentity", "existingFiles", "file" }).ToArray(),
                "inspect-files" => fields.Concat(new[] { "directoryIdentity", "files" }).ToArray(),
                _ => throw Invalid()
            });
            if (request.GetProperty("schema").GetString() != ScannerSaveSchema || !Guid.TryParseExact(request.GetProperty("operationId").GetString(), "D", out var id) || request.GetProperty("operationId").GetString() != id.ToString("D")) throw Invalid();
            string root = Absolute(request.GetProperty("repositoryRoot")), directory = Path.Combine(root, "switchyard-scan-" + id.ToString("D"));
            var files = operation == "write-file" ? ScannerControls(request.GetProperty("existingFiles"), complete: false)
                : operation == "inspect-files" ? ScannerControls(request.GetProperty("files"), complete: true) : Array.Empty<ScannerControl>();
            ScannerControl? next = null;
            if (operation == "write-file")
            {
                var value = request.GetProperty("file"); next = ScannerControlDescriptor(value, owned: false, content: true);
                if (files.Any(file => file.Path == next.Path)) throw Invalid();
                string encoded = value.GetProperty("contentBase64").GetString() ?? throw Invalid();
                if (encoded.Length > 436908) throw Invalid(); content = Convert.FromBase64String(encoded);
                if (content.Length != next.Size || Convert.ToBase64String(content) != encoded || Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant() != next.Sha256) throw Invalid();
            }
            var rootHandle = PinDirectories(root, handles);
            if (!Matches(Information(rootHandle, true), request.GetProperty("rootIdentity"))) throw Invalid();
            if (operation == "create-directory" && !CreateDirectoryW(NativeName(directory), IntPtr.Zero)) throw Invalid();
            var directoryHandle = Open(directory, true); handles.Add(directoryHandle);
            var directoryIdentity = Information(directoryHandle, true);
            if (operation != "create-directory" && !Matches(directoryIdentity, request.GetProperty("directoryIdentity"))) throw Invalid();
            ScannerDirectoryContents(directory, files.Select(file => file.Path));
            var verified = new List<object>();
            foreach (var file in files)
            {
                var actual = VerifyScannerControl(directory, file, retained);
                verified.Add(new { path = file.Path, sha256 = file.Sha256, size = file.Size, identity = Identity(actual) });
            }
            if (next != null)
            {
                using (var output = new FileStream(Path.Combine(directory, next.Path), FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    if (Information(output.SafeFileHandle, false).Links != 1) throw Invalid();
                    output.Write(content!); output.Flush(flushToDisk: true);
                    using var owned = JsonDocument.Parse(JsonSerializer.Serialize(Identity(Information(output.SafeFileHandle, false))));
                    next = next with { Identity = owned.RootElement.Clone() };
                }
                var actual = VerifyScannerControl(directory, next, retained);
                verified.Add(new { path = next.Path, sha256 = next.Sha256, size = next.Size, identity = Identity(actual) });
            }
            ScannerDirectoryContents(directory, files.Select(file => file.Path).Concat(next == null ? Array.Empty<string>() : new[] { next.Path }));
            if (!Matches(Information(rootHandle, true), request.GetProperty("rootIdentity")) || operation != "create-directory" && !Matches(Information(directoryHandle, true), request.GetProperty("directoryIdentity"))) throw Invalid();
            Console.WriteLine(JsonSerializer.Serialize(new { schema = ScannerSaveSchema, operationId = id.ToString("D"), operation, requestSha256 = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw))).ToLowerInvariant(), rootIdentity = Identity(Information(rootHandle, true)), directoryIdentity = Identity(directoryIdentity), files = verified, authorityGranted = false, scanPerformed = false }));
            return 0;
        }
        catch { Console.Error.WriteLine("Exact Windows scanner setup operation failed. Preserve partial or uncertain output without replay."); return 2; }
        finally { if (content != null) CryptographicOperations.ZeroMemory(content); foreach (var stream in retained.AsEnumerable().Reverse()) stream.Dispose(); foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }
}
