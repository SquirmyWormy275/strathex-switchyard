using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// Fixed filesystem operation only. This mode does not launch a recipe or claim
// VM containment. The caller pre-creates and durably records one empty directory.
[SupportedOSPlatform("windows")]
internal static partial class ReviewedInputStager
{
    private const string Schema = "switchyard-windows-reviewed-inputs/v1";
    private const uint GenericRead = 0x80000000, ReadAttributes = 0x80, ReadControl = 0x20000, WriteDac = 0x40000;
    private const uint ShareRead = 1, ShareWrite = 2, OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000, OpenReparsePoint = 0x00200000;
    private const uint DirectoryAttribute = 0x10, ReparseAttribute = 0x400;
    private static readonly Regex Reserved = new(@"^(con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Digest = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private sealed record Input(string Path, string Sha256, int Size);
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumeInformationW(string root, StringBuilder? volume, uint volumeLength, out uint serial, out uint maximumComponent, out uint flags, StringBuilder filesystem, uint filesystemLength);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string link, string existing, IntPtr security);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, [MarshalAs(UnmanagedType.Bool)] out bool present, out IntPtr acl, [MarshalAs(UnmanagedType.Bool)] out bool defaulted);
    [DllImport("advapi32.dll")]
    private static extern uint SetSecurityInfo(SafeFileHandle handle, uint type, uint information, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

    private static Exception Invalid() => new InvalidOperationException("The exact reviewed input staging boundary was not verified.");
    private static FileInformation Information(SafeFileHandle handle, bool directory)
    {
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var value) || (value.Attributes & ReparseAttribute) != 0 || ((value.Attributes & DirectoryAttribute) != 0) != directory) throw Invalid();
        return value;
    }
    private static object Identity(FileInformation value) => new { device = value.Volume.ToString(CultureInfo.InvariantCulture), inode = (((ulong)value.IndexHigh << 32) | value.IndexLow).ToString(CultureInfo.InvariantCulture) };
    private static bool Matches(FileInformation value, JsonElement expected)
    {
        Exact(expected, "device", "inode");
        return expected.GetProperty("device").GetString() == value.Volume.ToString(CultureInfo.InvariantCulture)
            && expected.GetProperty("inode").GetString() == (((ulong)value.IndexHigh << 32) | value.IndexLow).ToString(CultureInfo.InvariantCulture);
    }
    private static void Exact(JsonElement value, params string[] fields)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() != fields.Length || value.EnumerateObject().Any(property => !fields.Contains(property.Name, StringComparer.Ordinal))) throw Invalid();
    }
    private static string Absolute(JsonElement value) => Absolute(value.GetString() ?? throw Invalid());
    private static string Absolute(string path)
    {
        if (path.Length > 2048 || !Regex.IsMatch(path, @"^[A-Za-z]:[\\/]", RegexOptions.CultureInvariant) || path[2..].Contains(':') || path.Any(char.IsControl)
            || path.Split('\\', '/').Skip(1).Any(part => part is "." or ".." || part.EndsWith(' ') || part.EndsWith('.') || Reserved.IsMatch(part))) throw Invalid();
        string full = Path.GetFullPath(path);
        if (full.Length <= Path.GetPathRoot(full)!.Length) throw Invalid();
        var filesystem = new StringBuilder(32);
        if (!GetVolumeInformationW(Path.GetPathRoot(full)!, null, 0, out _, out _, out _, filesystem, 32) || filesystem.ToString() != "NTFS") throw Invalid();
        return full;
    }
    private static string NativeName(string path) => @"\\?\" + path;
    private static bool Inside(string root, string path) => path.StartsWith(Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    private static SafeFileHandle Open(string path, bool directory, uint extraAccess = 0)
    {
        var handle = CreateFileW(NativeName(path), (directory ? ReadAttributes : GenericRead) | extraAccess, directory ? ShareRead | ShareWrite : ShareRead, IntPtr.Zero, OpenExisting, OpenReparsePoint | (directory ? BackupSemantics : 0), IntPtr.Zero);
        try { Information(handle, directory); return handle; }
        catch { handle.Dispose(); throw; }
    }
    // Keeping each ancestor open without FILE_SHARE_DELETE prevents a named
    // directory from being swapped between validation and the selected read.
    private static SafeFileHandle PinDirectories(string path, List<SafeFileHandle> handles, uint finalAccess = 0)
    {
        string current = Path.GetPathRoot(path)!;
        var root = Open(current, true, string.Equals(current, path, StringComparison.OrdinalIgnoreCase) ? finalAccess : 0); handles.Add(root);
        foreach (string component in path[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            root = Open(current, true, string.Equals(current, path, StringComparison.OrdinalIgnoreCase) ? finalAccess : 0); handles.Add(root);
        }
        return root;
    }
    private static void RestrictNewDirectory(SafeFileHandle directory)
    {
        string sid = WindowsIdentity.GetCurrent().User?.Value ?? throw Invalid();
        string descriptor = $"D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(descriptor, 1, out var memory, out _)) throw Invalid();
        try
        {
            if (!GetSecurityDescriptorDacl(memory, out bool present, out var acl, out _) || !present || acl == IntPtr.Zero || SetSecurityInfo(directory, 1, 0x80000004, IntPtr.Zero, IntPtr.Zero, acl, IntPtr.Zero) != 0) throw Invalid();
        }
        finally { LocalFree(memory); }
        VerifyPrivateDirectory(directory);
    }
    private static void VerifyPrivateDirectory(SafeFileHandle directory, bool requireProtected = true)
    {
        string sid = WindowsIdentity.GetCurrent().User?.Value ?? throw Invalid();
        if (GetSecurityInfo(directory, 1, 4, out _, out _, out _, out _, out var observed) != 0) throw Invalid();
        try
        {
            uint length = GetSecurityDescriptorLength(observed); if (length is < 20 or > 65536) throw Invalid();
            var bytes = new byte[checked((int)length)]; Marshal.Copy(observed, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            if (requireProtected && (security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || security.DiscretionaryAcl is not { Count: 3 } acl) throw Invalid();
            var allowed = new HashSet<string>(StringComparer.Ordinal) { sid, "S-1-5-18", "S-1-5-32-544" };
            var found = new HashSet<string>(StringComparer.Ordinal);
            foreach (GenericAce entry in acl)
            {
                if (entry is not CommonAce ace || ace.AceQualifier != AceQualifier.AccessAllowed || !allowed.Contains(ace.SecurityIdentifier.Value) || (ace.AccessMask & 0x1f01ff) != 0x1f01ff || (ace.AceFlags & (AceFlags.ContainerInherit | AceFlags.ObjectInherit)) != (AceFlags.ContainerInherit | AceFlags.ObjectInherit)) throw Invalid();
                found.Add(ace.SecurityIdentifier.Value);
            }
            if (!found.SetEquals(allowed)) throw Invalid();
        }
        finally { LocalFree(observed); }
    }
    private static Input[] Inputs(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() is < 1 or > 4096) throw Invalid();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase); var inputs = new List<Input>(); long bytes = 0;
        foreach (var item in value.EnumerateArray())
        {
            Exact(item, "path", "sha256", "size", "classification");
            string path = item.GetProperty("path").GetString() ?? throw Invalid(), sha = item.GetProperty("sha256").GetString() ?? throw Invalid();
            if (path.Length is < 1 or > 512 || path.Any(char.IsControl) || path.IndexOfAny(new[] { '\\', ':', '*', '?', '[', ']' }) >= 0 || !seen.Add(path)
                || path.Split('/').Any(part => part.Length == 0 || part is "." or ".." || part.Equals(".git", StringComparison.OrdinalIgnoreCase) || part.EndsWith(' ') || part.EndsWith('.') || Reserved.IsMatch(part))
                || !Digest.IsMatch(sha) || !item.GetProperty("size").TryGetInt32(out int size) || size is < 0 or > 4 * 1024 * 1024 || item.GetProperty("classification").GetString() != "non-production") throw Invalid();
            string[] parts = path.Split('/'); if (parts.Length > 32 || directories.Contains(path)) throw Invalid();
            for (int end=1;end<parts.Length;end++) { string directory=string.Join('/',parts.Take(end)); if(seen.Contains(directory))throw Invalid();directories.Add(directory); }
            if(directories.Count>4096)throw Invalid();
            bytes += size; if (bytes > 64 * 1024 * 1024) throw Invalid();
            inputs.Add(new Input(path, sha, size));
        }
        return inputs.ToArray();
    }
    public static int Run()
    {
        var handles = new List<SafeFileHandle>();
        ReviewedIndexInputs.Packet? indexPacket = null;
        ReviewedHistoryInputs.Packet? historyPacket = null;
        try
        {
            PipeTextProtocol.Configure();
            var text = new StringBuilder(); int character;
            while ((character = Console.In.Read()) != -1 && character != '\n') { if (character == '\r' || text.Length >= 524288) throw Invalid(); text.Append((char)character); }
            if (Encoding.UTF8.GetByteCount(text.ToString()) > 524288) throw Invalid();
            using var document = JsonDocument.Parse(text.ToString()); var request = document.RootElement;
            bool withIndex = request.TryGetProperty("indexInputs", out var indexInputs);
            bool withHistory = request.TryGetProperty("historyInputs", out var historyInputs);
            if(withIndex && withHistory) throw Invalid();
            var fields = new[] { "schema", "operationId", "sourceRoot", "sourceIdentity", "stagingRoot", "stagingIdentity", "inputFiles", "inputManifestSha256" };
            Exact(request, fields.Concat(withIndex ? new[] { "indexInputs" } : withHistory ? new[] { "historyInputs" } : Array.Empty<string>()).ToArray());
            if (request.GetProperty("schema").GetString() != Schema || !Guid.TryParseExact(request.GetProperty("operationId").GetString(), "D", out var operation)) throw Invalid();
            string sourceRoot = Absolute(request.GetProperty("sourceRoot")), stageRoot = Absolute(request.GetProperty("stagingRoot"));
            if (sourceRoot.Equals(stageRoot, StringComparison.OrdinalIgnoreCase) || Inside(sourceRoot, stageRoot) || Inside(stageRoot, sourceRoot) || Path.GetFileName(stageRoot) != "inputs-" + operation.ToString("D")) throw Invalid();
            var inputs = Inputs(request.GetProperty("inputFiles"));
            string manifestDigest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.GetProperty("inputFiles").GetRawText()))).ToLowerInvariant();
            if (request.GetProperty("inputManifestSha256").GetString() != manifestDigest) throw Invalid();
            if (withIndex) indexPacket = ReviewedIndexInputs.Read(indexInputs, inputs.ToDictionary(file => file.Path, file => (file.Sha256, file.Size), StringComparer.Ordinal));
            if (withHistory) historyPacket = ReviewedHistoryInputs.Read(historyInputs, inputs.ToDictionary(file => file.Path, file => (file.Sha256, file.Size), StringComparer.Ordinal));
            var sourceHandle = PinDirectories(sourceRoot, handles);
            var stageHandle = PinDirectories(stageRoot, handles, WriteDac | ReadControl);
            var sourceIdentity = Information(sourceHandle, true); var stagingIdentity = Information(stageHandle, true);
            if (!Matches(sourceIdentity, request.GetProperty("sourceIdentity")) || !Matches(stagingIdentity, request.GetProperty("stagingIdentity")) || Directory.EnumerateFileSystemEntries(stageRoot).Any()) throw Invalid();
            RestrictNewDirectory(stageHandle);
            if (Directory.EnumerateFileSystemEntries(stageRoot).Any()) throw Invalid();
            var timer = Stopwatch.StartNew(); long total = 0;
            foreach (var file in inputs)
            {
                if (timer.ElapsedMilliseconds > 30000) throw Invalid();
                string source = Path.Combine(sourceRoot, file.Path.Replace('/', Path.DirectorySeparatorChar)), destination = Path.Combine(stageRoot, file.Path.Replace('/', Path.DirectorySeparatorChar));
                var parents = new List<SafeFileHandle>(); byte[]? bytes = null; FileStream? input = null;
                try
                {
                    if (indexPacket != null && indexPacket.Files.TryGetValue(file.Path, out var indexed)) bytes = indexed;
                    else if (historyPacket != null && historyPacket.Files.TryGetValue(file.Path, out var historical)) bytes = historical;
                    else if (file.Path.StartsWith(".switchyard-history/", StringComparison.Ordinal)) throw Invalid();
                    else
                    {
                        PinDirectories(Path.GetDirectoryName(source)!, parents);
                        input = new FileStream(Open(source, false), FileAccess.Read);
                        var before = Information(input.SafeFileHandle, false);
                        if ((((ulong)before.SizeHigh << 32) | before.SizeLow) != (ulong)file.Size) throw Invalid();
                        bytes = new byte[file.Size]; input.ReadExactly(bytes);
                        if (input.ReadByte() != -1) throw Invalid();
                    }
                    if (bytes.Length != file.Size || Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant() != file.Sha256 || timer.ElapsedMilliseconds > 30000) throw Invalid();
                    string directory = Path.GetDirectoryName(destination)!; Directory.CreateDirectory(directory);
                    PinDirectories(directory, parents);
                    using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { output.Write(bytes); output.Flush(flushToDisk: true); }
                    total += bytes.Length;
                }
                finally { if (bytes != null) CryptographicOperations.ZeroMemory(bytes); input?.Dispose(); foreach (var parent in parents.AsEnumerable().Reverse()) parent.Dispose(); }
            }
            if (!Matches(Information(sourceHandle, true), request.GetProperty("sourceIdentity")) || !Matches(Information(stageHandle, true), request.GetProperty("stagingIdentity"))) throw Invalid();
            if(historyPacket != null) Console.WriteLine(JsonSerializer.Serialize(new { schema = Schema, operationId = operation.ToString("D"), sourceIdentity = Identity(sourceIdentity), stagingIdentity = Identity(stagingIdentity), inputManifestSha256 = manifestDigest, files = inputs.Length, bytes = total, privateAclReadbackVerified = true, classification = "reviewed-non-production-bytes", sandboxEnforced = false, historyPacketSha256 = historyPacket.Digest, historyWitnessSha256 = historyPacket.WitnessDigest }));
            else if (indexPacket == null) Console.WriteLine(JsonSerializer.Serialize(new { schema = Schema, operationId = operation.ToString("D"), sourceIdentity = Identity(sourceIdentity), stagingIdentity = Identity(stagingIdentity), inputManifestSha256 = manifestDigest, files = inputs.Length, bytes = total, privateAclReadbackVerified = true, classification = "reviewed-non-production-bytes", sandboxEnforced = false }));
            else Console.WriteLine(JsonSerializer.Serialize(new { schema = Schema, operationId = operation.ToString("D"), sourceIdentity = Identity(sourceIdentity), stagingIdentity = Identity(stagingIdentity), inputManifestSha256 = manifestDigest, files = inputs.Length, bytes = total, privateAclReadbackVerified = true, classification = "reviewed-non-production-bytes", sandboxEnforced = false, indexPacketSha256 = indexPacket.Digest, indexWitnessSha256 = indexPacket.WitnessDigest }));
            return 0;
        }
        catch { Console.Error.WriteLine("Exact reviewed Windows input staging failed. Preserve partial owned staging for verification."); return 2; }
        finally { historyPacket?.Dispose(); indexPacket?.Dispose(); foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }

    // Link only this exact running helper image. The same image embeds the
    // fixed guest worker. A trusted host may additionally pin one node.exe;
    // neither mode copies a runtime or accepts arbitrary target tool names.
    public static int RunToolLink()
    {
        const string schema = "switchyard-windows-guest-tools/v1";
        var handles = new List<SafeFileHandle>(); var streams = new List<FileStream>(); string phase = "request";
        try
        {
            PipeTextProtocol.Configure();
            var text = new StringBuilder(); int character;
            while ((character = Console.In.Read()) != -1 && character != '\n') { if (character == '\r' || text.Length >= 8192) throw Invalid(); text.Append((char)character); }
            using var document = JsonDocument.Parse(text.ToString()); var request = document.RootElement;
            bool withNode = request.TryGetProperty("nodeRuntime", out var node);
            Exact(request, withNode ? new[] { "schema", "operationId", "sourceIdentity", "stagingRoot", "stagingIdentity", "expectedSha256", "nodeRuntime" } : new[] { "schema", "operationId", "sourceIdentity", "stagingRoot", "stagingIdentity", "expectedSha256" });
            if (request.GetProperty("schema").GetString() != schema || !Guid.TryParseExact(request.GetProperty("operationId").GetString(), "D", out var operation)) throw Invalid();
            string source = Environment.ProcessPath ?? throw Invalid(), stageRoot = Absolute(request.GetProperty("stagingRoot")), expected = request.GetProperty("expectedSha256").GetString() ?? "";
            if (!Path.GetFileName(source).Equals("Switchyard.Hotkeys.exe", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(stageRoot) != "tools-" + operation.ToString("D") || !Digest.IsMatch(expected)) throw Invalid();
            phase = "directory";
            PinDirectories(Absolute(Path.GetDirectoryName(source)!), handles);
            var stage = PinDirectories(stageRoot, handles, WriteDac | ReadControl); var stageIdentity = Information(stage, true);
            if (!Matches(stageIdentity, request.GetProperty("stagingIdentity")) || Directory.EnumerateFileSystemEntries(stageRoot).Any()) throw Invalid();
            RestrictNewDirectory(stage);
            phase = "source-image";
            using var stream = new FileStream(Open(source, false), FileAccess.Read); var sourceIdentity = Information(stream.SafeFileHandle, false);
            long bytes = checked((long)(((ulong)sourceIdentity.SizeHigh << 32) | sourceIdentity.SizeLow));
            if (!Matches(sourceIdentity, request.GetProperty("sourceIdentity")) || bytes is < 1 or > 128L * 1024 * 1024 || Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant() != expected) throw Invalid();
            string nodePath = "", nodeSha256 = ""; long nodeBytes = 0; FileInformation nodeIdentity = default;
            if (withNode)
            {
                phase = "node-runtime";
                Exact(node, "path", "identity", "sha256");
                nodePath = Absolute(node.GetProperty("path")); nodeSha256 = node.GetProperty("sha256").GetString() ?? "";
                if (!Path.GetFileName(nodePath).Equals("node.exe", StringComparison.OrdinalIgnoreCase) || !Digest.IsMatch(nodeSha256)) throw Invalid();
                PinDirectories(Path.GetDirectoryName(nodePath)!, handles);
                var nodeHandle = Open(nodePath, false); handles.Add(nodeHandle); var nodeStream = new FileStream(nodeHandle, FileAccess.Read); streams.Add(nodeStream); nodeIdentity = Information(nodeHandle, false);
                nodeBytes = checked((long)(((ulong)nodeIdentity.SizeHigh << 32) | nodeIdentity.SizeLow));
                if (!Matches(nodeIdentity, node.GetProperty("identity")) || nodeBytes is < 1 or > 128L * 1024 * 1024 || Matches(nodeIdentity, request.GetProperty("sourceIdentity")) || Convert.ToHexString(SHA256.HashData(nodeStream)).ToLowerInvariant() != nodeSha256) throw Invalid();
            }
            string target = Path.Combine(stageRoot, "b122-sandbox-worker.exe");
            phase = "hard-link";
            if (!CreateHardLinkW(NativeName(target), NativeName(source), IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            phase = "linked-identity";
            using var linked = Open(target, false); var actual = Information(linked, false);
            if (!Matches(actual, request.GetProperty("sourceIdentity")) || !Matches(Information(stage, true), request.GetProperty("stagingIdentity")) || Directory.EnumerateFileSystemEntries(stageRoot).Count() != 1) throw Invalid();
            bool embedded = typeof(Sxsy.B122.SandboxHelper.Program).Assembly == typeof(ReviewedInputStager).Assembly;
            if (!embedded) throw Invalid();
            object? runtimeProof = null;
            if (withNode)
            {
                phase = "node-hard-link";
                string nodeTarget = Path.Combine(stageRoot, "node.exe");
                if (!CreateHardLinkW(NativeName(nodeTarget), NativeName(nodePath), IntPtr.Zero)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                phase = "node-linked-identity";
                using var nodeLinked = Open(nodeTarget, false);
                if (!Matches(Information(nodeLinked, false), node.GetProperty("identity"))) throw Invalid();
                runtimeProof = new { identity = Identity(nodeIdentity), sha256 = nodeSha256, linkedBytes = nodeBytes, filename = "node.exe" };
            }
            if (!Matches(Information(stage, true), request.GetProperty("stagingIdentity")) || Directory.EnumerateFileSystemEntries(stageRoot).Count() != (withNode ? 2 : 1)) throw Invalid();
            var proof = new Dictionary<string, object?> { ["schema"] = schema, ["operationId"] = operation.ToString("D"), ["sourceIdentity"] = Identity(actual), ["stagingIdentity"] = Identity(stageIdentity), ["sha256"] = expected, ["linkedBytes"] = bytes, ["copiedBytes"] = 0, ["toolName"] = "b122-sandbox-worker.exe", ["privateAclReadbackVerified"] = true, ["workerEmbedded"] = true, ["sandboxEnforced"] = false };
            if (withNode) proof["nodeRuntime"] = runtimeProof;
            Console.WriteLine(JsonSerializer.Serialize(proof));
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine($"Native guest-tool staging failed at {phase}; Win32={(error is System.ComponentModel.Win32Exception native ? native.NativeErrorCode : 0)}. No runtime-copy fallback was used."); return 2; }
        finally { foreach (var stream in streams) stream.Dispose(); foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }

    // Creates only exchange.vhd inside an acknowledged new private directory.
    // This operation never attaches a disk or formats any host volume.
    public static int RunBoundedImage(bool inspect = false)
    {
        const string schema = "switchyard-windows-bounded-image/v1";
        var handles = new List<SafeFileHandle>(); string phase = "request";
        try
        {
            PipeTextProtocol.Configure();
            var text = new StringBuilder(); int character;
            while ((character = Console.In.Read()) != -1 && character != '\n') { if (character == '\r' || text.Length >= 8192) throw Invalid(); text.Append((char)character); }
            using var document = JsonDocument.Parse(text.ToString()); var request = document.RootElement;
            Exact(request, inspect ? new[] { "schema", "operationId", "stagingRoot", "stagingIdentity", "imageIdentity", "expectedImageSha256" } : new[] { "schema", "operationId", "stagingRoot", "stagingIdentity" });
            if (request.GetProperty("schema").GetString() != schema || !Guid.TryParseExact(request.GetProperty("operationId").GetString(), "D", out var operation) || operation == Guid.Empty) throw Invalid();
            string root = Absolute(request.GetProperty("stagingRoot"));
            if (Path.GetFileName(root) != "disk-" + operation.ToString("D")) throw Invalid();
            phase = "directory";
            var directory = PinDirectories(root, handles, ReadControl | (inspect ? 0 : WriteDac)); var original = Information(directory, true);
            if (!Matches(original, request.GetProperty("stagingIdentity"))) throw Invalid();
            if (inspect)
            {
                var entries = Directory.EnumerateFileSystemEntries(root).ToArray();
                if (entries.Length != 1 || Path.GetFileName(entries[0]) != "exchange.vhd") throw Invalid();
                VerifyPrivateDirectory(directory);
            }
            else { if (Directory.EnumerateFileSystemEntries(root).Any()) throw Invalid(); RestrictNewDirectory(directory); }
            phase = "create";
            using var image = inspect ? new FileStream(Open(Path.Combine(root, "exchange.vhd"), false), FileAccess.Read) : new FileStream(Path.Combine(root, "exchange.vhd"), FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read);
            var created = Information(image.SafeFileHandle, false);
            if (created.Links != 1 || inspect && !Matches(created, request.GetProperty("imageIdentity"))) throw Invalid();
            phase = "write";
            if (!inspect) { BoundedExchangeImage.WriteNew(image, operation); image.Flush(flushToDisk: true); }
            string footerSha256 = BoundedExchangeImage.Validate(image, operation);
            if (!Matches(Information(directory, true), request.GetProperty("stagingIdentity")) || Directory.EnumerateFileSystemEntries(root).Count() != 1 || Information(image.SafeFileHandle, false).Links != 1) throw Invalid();
            image.Position = 0; string imageSha256 = Convert.ToHexString(SHA256.HashData(image)).ToLowerInvariant();
            if (inspect && imageSha256 != request.GetProperty("expectedImageSha256").GetString()) throw Invalid();
            image.Dispose(); phase = "native-header";
            using var pinned = Open(Path.Combine(root, "exchange.vhd"), false);
            var current = Information(pinned, false);
            if (current.Volume != created.Volume || current.IndexHigh != created.IndexHigh || current.IndexLow != created.IndexLow) throw Invalid();
            BoundedExchangeImage.ReadNativeHeader(Path.Combine(root, "exchange.vhd"), operation);
            Console.WriteLine(JsonSerializer.Serialize(new { schema, operationId = operation.ToString("D"), stagingIdentity = Identity(original), imageIdentity = Identity(created), imageFilename = "exchange.vhd", virtualBytes = BoundedExchangeImage.VirtualBytes, backingBytes = BoundedExchangeImage.BackingBytes, filesystem = "FAT16", imageSha256, footerSha256, nativeHeaderVerified = true, privateAclReadbackVerified = true, attached = false, exchangeQuotaEnforced = false, sandboxEnforced = false }));
            return 0;
        }
        catch (Exception error) { string detail = error is InvalidOperationException && Regex.IsMatch(error.Message, "^native-vhd-[a-z0-9-]{1,100}$", RegexOptions.CultureInvariant) ? error.Message : "boundary"; Console.Error.WriteLine($"Native bounded exchange image failed at {phase}; Win32={(error is System.ComponentModel.Win32Exception native ? native.NativeErrorCode : 0)}; detail={detail}. Preserve any partial owned image; no disk was attached."); return 2; }
        finally { foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }
}
