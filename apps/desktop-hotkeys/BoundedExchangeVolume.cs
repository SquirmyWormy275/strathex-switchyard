using System.Buffers.Binary;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class ReviewedInputStager
{
    private const uint MountPointTag = 0xa0000003, GetReparsePoint = 0x000900a8, GetVolumeExtents = 0x00560000;
    [StructLayout(LayoutKind.Sequential)] private struct AttachParameters { public uint Version, Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenPrivileges { public uint Count, Low; public int High; public uint Attributes; }
    [DllImport("virtdisk.dll")] private static extern uint AttachVirtualDisk(SafeFileHandle handle, IntPtr security, uint flags, uint providerFlags, ref AttachParameters parameters, IntPtr overlapped);
    [DllImport("virtdisk.dll")] private static extern uint DetachVirtualDisk(SafeFileHandle handle, uint flags, uint providerFlags);
    [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)] private static extern uint GetVirtualDiskPhysicalPath(SafeFileHandle handle, ref uint bytes, StringBuilder path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr FindFirstVolumeW(StringBuilder name, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FindNextVolumeW(IntPtr find, StringBuilder name, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FindVolumeClose(IntPtr find);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetVolumeMountPointW(string path, string volume);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteVolumeMountPointW(string path);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetVolumeNameForVolumeMountPointW(string path, StringBuilder volume, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetDiskFreeSpaceExW(string path, out ulong available, out ulong total, out ulong free);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, uint inputBytes, [Out] byte[] output, uint outputBytes, out uint returned, IntPtr overlapped);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValueW(string? system, string name, out long luid);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AdjustTokenPrivileges(SafeFileHandle token, [MarshalAs(UnmanagedType.Bool)] bool disableAll, ref TokenPrivileges privileges, uint previousBytes, IntPtr previous, IntPtr required);

    private static void NativeSuccess(uint error) { if (error != 0) throw new Win32Exception(checked((int)error)); }
    private static void ManageVolumePrivilege()
    {
        if (!OpenProcessToken(new IntPtr(-1), 0x28, out var raw)) throw new Win32Exception(Marshal.GetLastWin32Error());
        using var token = new SafeFileHandle(raw, true);
        if (!LookupPrivilegeValueW(null, "SeManageVolumePrivilege", out long luid)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var privilege = new TokenPrivileges { Count = 1, Low = unchecked((uint)luid), High = unchecked((int)(luid >> 32)), Attributes = 2 };
        if (!AdjustTokenPrivileges(token, false, ref privilege, 0, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        NativeSuccess(checked((uint)Marshal.GetLastWin32Error()));
    }
    private static bool VolumeName(string value) => value.Length == 49 && value.StartsWith(@"\\?\Volume{", StringComparison.OrdinalIgnoreCase) && value.EndsWith(@"}\", StringComparison.Ordinal) && Guid.TryParseExact(value.Substring(11, 36), "D", out _);
    private static uint OwnedDiskNumber(SafeFileHandle image)
    {
        var name = new StringBuilder(256); uint bytes = 512; NativeSuccess(GetVirtualDiskPhysicalPath(image, ref bytes, name));
        var match = Regex.Match(name.ToString(), @"^\\\\\.\\PhysicalDrive([0-9]{1,6})$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!match.Success || !uint.TryParse(match.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out uint number)) throw new InvalidOperationException("native-volume-device-name");
        return number;
    }
    private static bool MatchesExtent(string volume, uint disk)
    {
        if (!VolumeName(volume)) return false;
        using var device = CreateFileW(volume.TrimEnd('\\'), 0, ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
        if (device.IsInvalid) return false;
        var extent = new byte[32];
        return DeviceIoControl(device, GetVolumeExtents, IntPtr.Zero, 0, extent, 32, out uint used, IntPtr.Zero) && used == 32
            && BinaryPrimitives.ReadUInt32LittleEndian(extent) == 1 && BinaryPrimitives.ReadUInt32LittleEndian(extent.AsSpan(8)) == disk
            && BinaryPrimitives.ReadInt64LittleEndian(extent.AsSpan(16)) == BoundedExchangeImage.PartitionSector * 512L
            && BinaryPrimitives.ReadInt64LittleEndian(extent.AsSpan(24)) == BoundedExchangeImage.PartitionSectors * 512L;
    }
    private static string FindOwnedVolume(SafeFileHandle image)
    {
        uint disk = OwnedDiskNumber(image); var name = new StringBuilder(256); var find = FindFirstVolumeW(name, 256);
        if (find == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        string? owned = null;
        try
        {
            for (int count = 0; ; count++)
            {
                if (count >= 256) throw new InvalidOperationException("native-volume-enumeration-bound");
                if (MatchesExtent(name.ToString(), disk)) { if (owned != null) throw new InvalidOperationException("native-volume-ambiguous-extent"); owned = name.ToString(); }
                if (!FindNextVolumeW(find, name, 256)) { int error = Marshal.GetLastWin32Error(); if (error != 18) throw new Win32Exception(error); break; }
            }
        }
        finally { FindVolumeClose(find); }
        return owned ?? throw new InvalidOperationException("native-volume-not-ready");
    }
    private static SafeFileHandle PinMount(string path, JsonElement expected, bool restrictNew, out bool mounted, string? brokerSid = null)
    {
        var handle = CreateFileW(NativeName(path), ReadAttributes | ReadControl | (restrictNew ? WriteDac : 0), ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        try
        {
            if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var information) || (information.Attributes & DirectoryAttribute) == 0 || !Matches(information, expected)) throw Invalid();
            mounted = (information.Attributes & ReparseAttribute) != 0;
            if (mounted)
            {
                var reparse = new byte[16384];
                if (!DeviceIoControl(handle, GetReparsePoint, IntPtr.Zero, 0, reparse, (uint)reparse.Length, out uint used, IntPtr.Zero) || used < 16 || BinaryPrimitives.ReadUInt32LittleEndian(reparse) != MountPointTag) throw new InvalidOperationException("native-volume-mount-tag");
                if (brokerSid == null) VerifyPrivateDirectory(handle); else WindowsStorageBrokerFiles.VerifyMountDirectory(handle, brokerSid);
            }
            else
            {
                if (Directory.EnumerateFileSystemEntries(path).Any()) throw new InvalidOperationException("native-volume-foreign-mount-entries");
                if (brokerSid != null) WindowsStorageBrokerFiles.VerifyMountDirectory(handle, brokerSid);
                else if (restrictNew) RestrictNewDirectory(handle); else VerifyPrivateDirectory(handle, requireProtected: false);
            }
            return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private static ulong VerifyMount(string path, string volume, SafeFileHandle image, Guid operation)
    {
        var named = new StringBuilder(256);
        if (!GetVolumeNameForVolumeMountPointW(path + "\\", named, 256)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!string.Equals(named.ToString(), volume, StringComparison.OrdinalIgnoreCase) || !MatchesExtent(volume, OwnedDiskNumber(image))) throw new InvalidOperationException("native-volume-mount-target");
        var filesystem = new StringBuilder(32); var label = new StringBuilder(32);
        if (!GetVolumeInformationW(volume, label, 32, out uint serial, out _, out _, filesystem, 32)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (filesystem.ToString() != "FAT" || label.ToString() != "SWITCHYARD" || serial != BinaryPrimitives.ReadUInt32LittleEndian(operation.ToByteArray())) throw new InvalidOperationException("native-volume-filesystem");
        if (!GetDiskFreeSpaceExW(volume, out _, out ulong total, out _) || total == 0 || total > (ulong)BoundedExchangeImage.PartitionSectors * 512) throw new InvalidOperationException("native-volume-capacity");
        return total;
    }

    // Read-only mapping admission. Keep every original handle pinned through
    // native VM creation; an ordinary directory or arbitrary junction cannot
    // substitute for this exact, already attached bounded volume.
    public static IDisposable PinBoundedMapping(JsonElement binding, string mappedRoot)
    {
        var handles = new List<SafeFileHandle>();
        try
        {
            bool brokerBinding = binding.TryGetProperty("broker", out _);
            Exact(binding, brokerBinding ? new[] { "schema", "operationId", "stagingRoot", "stagingIdentity", "imageIdentity", "mountIdentity", "footerSha256", "volumeGuid", "broker" } : new[] { "schema", "operationId", "stagingRoot", "stagingIdentity", "imageIdentity", "mountIdentity", "footerSha256", "volumeGuid" });
            if (binding.GetProperty("schema").GetString() != "switchyard-windows-bounded-volume/v1"
                || !Guid.TryParseExact(binding.GetProperty("operationId").GetString(), "D", out var operation) || operation == Guid.Empty
                || !Digest.IsMatch(binding.GetProperty("footerSha256").GetString() ?? "")) throw Invalid();
            string root = Absolute(binding.GetProperty("stagingRoot")), volume = binding.GetProperty("volumeGuid").GetString() ?? "";
            if (Path.GetFileName(root) != "disk-" + operation.ToString("D") || !VolumeName(volume)
                || !string.Equals(Path.GetFullPath(mappedRoot), Path.Combine(root, "mount"), StringComparison.OrdinalIgnoreCase)) throw Invalid();
            var broker = brokerBinding ? WindowsStorageBrokerExchangeMapping.Validate(binding) : null;
            if (broker != null) foreach (string parent in new[] { broker.Root, Path.Combine(broker.Root, WindowsStorageBrokerExchangeFiles.DirectoryName), new WindowsStorageBrokerExchangeFiles(broker).OperationRoot(operation.ToString("D")) }) handles.Add(WindowsStorageBrokerFiles.PinDirectory(parent, broker.ClientSid));
            var directory = PinDirectories(root, handles, ReadControl);
            if (!Matches(Information(directory, true), binding.GetProperty("stagingIdentity"))) throw Invalid();
            if (broker == null) VerifyPrivateDirectory(directory); else handles.Add(WindowsStorageBrokerFiles.PinDirectory(root, broker.ClientSid));
            if (!Directory.EnumerateFileSystemEntries(root).Select(Path.GetFileName).Order(StringComparer.Ordinal).SequenceEqual(new[] { "exchange.vhd", "mount" })) throw Invalid();
            string imagePath = Path.Combine(root, "exchange.vhd"), mountPath = Path.Combine(root, "mount");
            var metadata = CreateFileW(NativeName(imagePath), GenericRead, ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero); handles.Add(metadata);
            var original = Information(metadata, false);
            if (!Matches(original, binding.GetProperty("imageIdentity")) || original.Links != 1
                || (((ulong)original.SizeHigh << 32) | original.SizeLow) != (ulong)BoundedExchangeImage.BackingBytes) throw Invalid();
            var footer = new byte[512]; int read = 0;
            while (read < footer.Length)
            {
                int count = RandomAccess.Read(metadata, footer.AsSpan(read), BoundedExchangeImage.BackingBytes - 512 + read);
                if (count == 0) throw Invalid(); read += count;
            }
            if (Convert.ToHexString(SHA256.HashData(footer)).ToLowerInvariant() != binding.GetProperty("footerSha256").GetString()) throw Invalid();
            var mount = PinMount(mountPath, binding.GetProperty("mountIdentity"), false, out bool mounted, broker?.ClientSid); handles.Add(mount);
            if (!mounted) throw Invalid();
            var image = BoundedExchangeImage.OpenNativeImage(imagePath, operation, 0x00080000, 0); handles.Add(image);
            if (!BoundedExchangeImage.ReadNativeState(image, operation)) throw Invalid();
            VerifyMount(mountPath, volume, image, operation);
            return new BoundedMappingPins(handles);
        }
        catch { foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); throw; }
    }
    private sealed class BoundedMappingPins(List<SafeFileHandle> handles) : IDisposable
    {
        public void Dispose() { foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }

    private static JsonElement BoundedVolume(JsonElement request, ref string phase, WindowsStorageBrokerInstallation.Settings? broker = null)
    {
        const string schema = "switchyard-windows-bounded-volume/v1"; var handles = new List<SafeFileHandle>();
        try
        {
            string action = request.GetProperty("action").GetString() ?? ""; bool attach = action == "attach";
            Exact(request, attach ? new[] { "schema", "action", "operationId", "stagingRoot", "stagingIdentity", "imageIdentity", "mountIdentity", "footerSha256", "initialImageSha256" } : new[] { "schema", "action", "operationId", "stagingRoot", "stagingIdentity", "imageIdentity", "mountIdentity", "footerSha256" });
            if (request.GetProperty("schema").GetString() != schema || action is not ("attach" or "inspect" or "detach") || !Guid.TryParseExact(request.GetProperty("operationId").GetString(), "D", out var operation) || operation == Guid.Empty || !Digest.IsMatch(request.GetProperty("footerSha256").GetString() ?? "")) throw Invalid();
            string root = Absolute(request.GetProperty("stagingRoot")); if (Path.GetFileName(root) != "disk-" + operation.ToString("D")) throw Invalid();
            if (broker != null)
            {
                if (WindowsStorageBrokerFiles.CurrentOwnerSid() != "S-1-5-18" || !root.Equals(new WindowsStorageBrokerExchangeFiles(broker).DiskRoot(operation.ToString("D")), StringComparison.OrdinalIgnoreCase)) throw Invalid();
                foreach (string parent in new[] { broker.Root, Path.Combine(broker.Root, WindowsStorageBrokerExchangeFiles.DirectoryName), new WindowsStorageBrokerExchangeFiles(broker).OperationRoot(operation.ToString("D")) }) handles.Add(WindowsStorageBrokerFiles.PinDirectory(parent, broker.ClientSid));
            }
            phase = "directory"; var directory = PinDirectories(root, handles, ReadControl);
            if (!Matches(Information(directory, true), request.GetProperty("stagingIdentity"))) throw Invalid();
            if (broker == null) VerifyPrivateDirectory(directory); else handles.Add(WindowsStorageBrokerFiles.PinDirectory(root, broker.ClientSid));
            var entries = Directory.EnumerateFileSystemEntries(root).Select(Path.GetFileName).Order(StringComparer.Ordinal).ToArray();
            if (!entries.SequenceEqual(new[] { "exchange.vhd", "mount" })) throw new InvalidOperationException("native-volume-entry-set");
            string imagePath = Path.Combine(root, "exchange.vhd"), mountPath = Path.Combine(root, "mount");
            using var metadata = CreateFileW(NativeName(imagePath), ReadAttributes | (broker == null ? 0 : GenericRead), ShareRead | ShareWrite, IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero); var original = Information(metadata, false);
            if (!Matches(original, request.GetProperty("imageIdentity")) || original.Links != 1 || (((ulong)original.SizeHigh << 32) | original.SizeLow) != (ulong)BoundedExchangeImage.BackingBytes) throw Invalid();
            if (broker != null)
            {
                var footer = new byte[512]; int read = 0;
                while (read < footer.Length) { int count = RandomAccess.Read(metadata, footer.AsSpan(read), BoundedExchangeImage.VirtualBytes + read); if (count == 0) throw Invalid(); read += count; }
                if (Convert.ToHexString(SHA256.HashData(footer)).ToLowerInvariant() != request.GetProperty("footerSha256").GetString()) throw Invalid();
            }
            using var mount = PinMount(mountPath, request.GetProperty("mountIdentity"), attach, out bool mounted, broker?.ClientSid);
            if (attach)
            {
                if (mounted || Directory.EnumerateFileSystemEntries(mountPath).Any()) throw Invalid();
                phase = "initial-image"; using var initial = new FileStream(Open(imagePath, false), FileAccess.Read);
                if (BoundedExchangeImage.Validate(initial, operation) != request.GetProperty("footerSha256").GetString()) throw Invalid();
                initial.Position = 0; if (Convert.ToHexString(SHA256.HashData(initial)).ToLowerInvariant() != request.GetProperty("initialImageSha256").GetString()) throw Invalid();
            }
            phase = "privilege"; if (action != "inspect") ManageVolumePrivilege();
            bool loaded; string? volume = null; ulong volumeBytes = 0;
            phase = "open-image";
            using (var image = BoundedExchangeImage.OpenNativeImage(imagePath, operation, attach ? 0x000e0000U : 0x000c0000U, attach ? 1U : 0U))
            {
                loaded = BoundedExchangeImage.ReadNativeState(image, operation);
                if (attach)
                {
                    if (loaded) throw new InvalidOperationException("native-volume-already-attached");
                    phase = "attach"; var parameters = new AttachParameters { Version = 1 }; NativeSuccess(AttachVirtualDisk(image, IntPtr.Zero, 6, 0, ref parameters, IntPtr.Zero)); loaded = true;
                    phase = "find-volume"; var until = DateTime.UtcNow.AddSeconds(10);
                    while (true) { try { volume = FindOwnedVolume(image); break; } catch (InvalidOperationException error) when (error.Message == "native-volume-not-ready" && DateTime.UtcNow < until) { Thread.Sleep(50); } }
                    phase = "mount"; if (!SetVolumeMountPointW(mountPath + "\\", volume)) throw new Win32Exception(Marshal.GetLastWin32Error()); mounted = true;
                }
                if (mounted)
                {
                    if (!loaded) throw new InvalidOperationException("native-volume-mount-without-image");
                    volume ??= FindOwnedVolume(image); phase = "verify-volume"; volumeBytes = VerifyMount(mountPath, volume, image, operation);
                }
                loaded = BoundedExchangeImage.ReadNativeState(image, operation);
                if (mounted && !loaded) throw new InvalidOperationException("native-volume-mount-without-image");
                if (action == "detach")
                {
                    phase = "unmount";
                    if (mounted) { if (!DeleteVolumeMountPointW(mountPath + "\\")) throw new Win32Exception(Marshal.GetLastWin32Error()); mounted = false; }
                    phase = "detach"; if (loaded) NativeSuccess(DetachVirtualDisk(image, 0, 0));
                }
            }
            if (action == "detach")
            {
                phase = "detached-readback"; using var observed = BoundedExchangeImage.OpenNativeImage(imagePath, operation, 0x000c0000, 0);
                loaded = BoundedExchangeImage.ReadNativeState(observed, operation); if (loaded) throw new InvalidOperationException("native-volume-detach-unconfirmed");
                using var raw = new FileStream(Open(imagePath, false), FileAccess.Read); if (BoundedExchangeImage.Validate(raw, operation) != request.GetProperty("footerSha256").GetString()) throw Invalid();
                if (!GetFileInformationByHandle(mount, out var cleared) || (cleared.Attributes & ReparseAttribute) != 0 || !Matches(cleared, request.GetProperty("mountIdentity"))) throw new InvalidOperationException("native-volume-unmount-unconfirmed");
            }
            if (!GetFileInformationByHandle(mount, out var finalMount) || !Matches(finalMount, request.GetProperty("mountIdentity")) || (finalMount.Attributes & DirectoryAttribute) == 0 || ((finalMount.Attributes & ReparseAttribute) != 0) != mounted) throw new InvalidOperationException("native-volume-mount-identity");
            if (mounted)
            {
                var reparse = new byte[16384];
                if (!DeviceIoControl(mount, GetReparsePoint, IntPtr.Zero, 0, reparse, (uint)reparse.Length, out uint used, IntPtr.Zero) || used < 16 || BinaryPrimitives.ReadUInt32LittleEndian(reparse) != MountPointTag) throw new InvalidOperationException("native-volume-mount-tag");
                if (broker == null) VerifyPrivateDirectory(mount); else WindowsStorageBrokerFiles.VerifyMountDirectory(mount, broker.ClientSid);
            }
            if (!Matches(Information(metadata, false), request.GetProperty("imageIdentity")) || !Matches(Information(directory, true), request.GetProperty("stagingIdentity"))) throw Invalid();
            return JsonSerializer.SerializeToElement(new { schema, action, operationId = operation.ToString("D"), stagingIdentity = request.GetProperty("stagingIdentity"), imageIdentity = Identity(original), mountIdentity = request.GetProperty("mountIdentity"), volume, mounted, attached = loaded, detachedVerified = !loaded && !mounted, virtualBytes = BoundedExchangeImage.VirtualBytes, backingBytes = BoundedExchangeImage.BackingBytes, volumeBytes, exchangeQuotaEnforced = loaded && mounted, sandboxEnforced = false });
        }

        finally { foreach (var handle in handles.AsEnumerable().Reverse()) handle.Dispose(); }
    }

    internal static JsonElement BrokerBoundedVolume(WindowsStorageBrokerInstallation.Settings settings, JsonElement request)
    {
        string phase = "request"; return BoundedVolume(request, ref phase, settings);
    }
    public static int RunBoundedVolume()
    {
        string phase = "request";
        try
        {
            Console.InputEncoding = new UTF8Encoding(false, true); Console.OutputEncoding = new UTF8Encoding(false);
            var text = new StringBuilder(); int character; while ((character = Console.In.Read()) != -1 && character != '\n') { if (character == '\r' || text.Length >= 8192) throw Invalid(); text.Append((char)character); }
            using var document = JsonDocument.Parse(text.ToString()); Console.WriteLine(BoundedVolume(document.RootElement, ref phase).GetRawText()); return 0;
        }
        catch (Exception error) { string detail = error is InvalidOperationException && Regex.IsMatch(error.Message, "^native-(?:vhd|volume)-[a-z0-9-]{1,100}$", RegexOptions.CultureInvariant) ? error.Message : "boundary"; Console.Error.WriteLine($"Native bounded volume failed at {phase}; Win32={(error is Win32Exception native ? native.NativeErrorCode : 0)}; detail={detail}. Preserve the exact owned image and mount until independent reconciliation."); return 2; }
    }
}
