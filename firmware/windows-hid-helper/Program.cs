#nullable enable
using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

internal sealed record Identity(ushort VendorId, ushort ProductId, ushort UsagePage, ushort Usage, string? Serial);
internal sealed record HidInterface(string Path, ushort InputLength, ushort OutputLength);
internal sealed record WriteCommand(string DeviceId, byte[] Frame);

internal static class Program
{
    private static readonly Channel<WriteCommand> Writes = Channel.CreateBounded<WriteCommand>(new BoundedChannelOptions(32) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true, SingleWriter = true });

    public static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return 2;
        Identity identity;
        try { identity = ParseIdentity(args); }
        catch (Exception error) { await Emit(new { type = "error", detail = error.Message }); return 2; }

        using var shutdown = new CancellationTokenSource();
        _ = ReadCommands(shutdown);
        while (!shutdown.IsCancellationRequested)
        {
            var device = NativeHid.Enumerate().SingleOrDefault(candidate => NativeHid.Matches(candidate, identity));
            if (device is null) { await Task.Delay(500, shutdown.Token).ConfigureAwait(false); continue; }
            var deviceId = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{device.Path}:{Guid.NewGuid():N}"))).ToLowerInvariant();
            try
            {
                using var handle = NativeHid.Open(device.Path);
                using var stream = new FileStream(handle, FileAccess.ReadWrite, Math.Max(device.InputLength, device.OutputLength), true);
                await Emit(new { type = "connected", deviceId });
                using var connected = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
                var read = ReadReports(stream, device, deviceId, connected.Token);
                var write = WriteReports(stream, device, deviceId, connected.Token);
                await Task.WhenAny(read, write).ConfigureAwait(false);
                connected.Cancel();
                try { await Task.WhenAll(read, write).ConfigureAwait(false); } catch (OperationCanceledException) { }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                await Emit(new { type = "error", detail = "HID connection failed closed." });
            }
            await Emit(new { type = "disconnected", deviceId });
            await Task.Delay(250, shutdown.Token).ConfigureAwait(false);
        }
        return 0;
    }

    private static Identity ParseIdentity(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length || !args[index].StartsWith("--", StringComparison.Ordinal) || !values.TryAdd(args[index], args[index + 1])) throw new ArgumentException("Invalid helper arguments.");
        }
        ushort Required(string name) => values.TryGetValue(name, out var text) && ushort.TryParse(text, out var value) ? value : throw new ArgumentException($"Missing or invalid {name}.");
        var allowed = new[] { "--vendor-id", "--product-id", "--usage-page", "--usage", "--serial" };
        if (values.Keys.Any(key => !allowed.Contains(key, StringComparer.Ordinal))) throw new ArgumentException("Unknown helper argument.");
        var serial = values.GetValueOrDefault("--serial");
        if (serial is not null && (serial.Length is < 1 or > 128 || serial.Any(character => !(char.IsAsciiLetterOrDigit(character) || "._-".Contains(character))))) throw new ArgumentException("Invalid serial number.");
        return new Identity(Required("--vendor-id"), Required("--product-id"), Required("--usage-page"), Required("--usage"), serial);
    }

    private static async Task ReadCommands(CancellationTokenSource shutdown)
    {
        while (!shutdown.IsCancellationRequested)
        {
            var line = await Console.In.ReadLineAsync(shutdown.Token).ConfigureAwait(false);
            if (line is null) { shutdown.Cancel(); return; }
            if (line.Length > 4096) continue;
            try
            {
                using var json = JsonDocument.Parse(line);
                var root = json.RootElement;
                if (root.GetProperty("type").GetString() != "write") continue;
                var deviceId = root.GetProperty("deviceId").GetString() ?? "";
                if (deviceId.Length != 64 || deviceId.Any(character => !Uri.IsHexDigit(character))) continue;
                var frame = Convert.FromBase64String(root.GetProperty("frame").GetString() ?? "");
                if (frame.Length == 32) await Writes.Writer.WriteAsync(new WriteCommand(deviceId, frame), shutdown.Token).ConfigureAwait(false);
            }
            catch (Exception error) when (error is JsonException or FormatException or KeyNotFoundException or InvalidOperationException) { }
        }
    }

    private static async Task ReadReports(FileStream stream, HidInterface device, string deviceId, CancellationToken cancellation)
    {
        var rented = ArrayPool<byte>.Shared.Rent(device.InputLength);
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                var count = await stream.ReadAsync(rented.AsMemory(0, device.InputLength), cancellation).ConfigureAwait(false);
                if (count == 0) throw new IOException("HID disconnected.");
                var offset = count == 33 && rented[0] == 0 ? 1 : 0;
                if (count - offset != 32) continue;
                await Emit(new { type = "frame", deviceId, frame = Convert.ToBase64String(rented, offset, 32) });
            }
        }
        finally { CryptographicOperations.ZeroMemory(rented); ArrayPool<byte>.Shared.Return(rented); }
    }

    private static async Task WriteReports(FileStream stream, HidInterface device, string deviceId, CancellationToken cancellation)
    {
        await foreach (var command in Writes.Reader.ReadAllAsync(cancellation).ConfigureAwait(false))
        {
            if (!StringComparer.Ordinal.Equals(command.DeviceId, deviceId)) continue;
            var frame = command.Frame;
            if (device.OutputLength == 33)
            {
                var report = new byte[33]; Buffer.BlockCopy(frame, 0, report, 1, 32);
                await stream.WriteAsync(report, cancellation).ConfigureAwait(false);
            }
            else if (device.OutputLength == 32) await stream.WriteAsync(frame, cancellation).ConfigureAwait(false);
            else throw new IOException("Unexpected HID output report length.");
            await stream.FlushAsync(cancellation).ConfigureAwait(false);
        }
    }

    private static Task Emit(object value) => Console.Out.WriteLineAsync(JsonSerializer.Serialize(value));
}

internal static class NativeHid
{
    private const uint DigcfPresent = 0x2, DigcfDeviceInterface = 0x10, GenericRead = 0x80000000, GenericWrite = 0x40000000, OpenExisting = 3, FileFlagOverlapped = 0x40000000;
    private static readonly Guid HidGuid = GetHidGuid();

    public static IEnumerable<HidInterface> Enumerate()
    {
        var hidGuid = HidGuid;
        var set = SetupDiGetClassDevs(ref hidGuid, null, IntPtr.Zero, DigcfPresent | DigcfDeviceInterface);
        if (set == new IntPtr(-1)) yield break;
        try
        {
            for (uint index = 0; ; index++)
            {
                var data = new DeviceInterfaceData { Size = Marshal.SizeOf<DeviceInterfaceData>() };
                if (!SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hidGuid, index, ref data)) yield break;
                SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out var required, IntPtr.Zero);
                var detail = Marshal.AllocHGlobal((int)required);
                try
                {
                    Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                    if (!SetupDiGetDeviceInterfaceDetail(set, ref data, detail, required, out _, IntPtr.Zero)) continue;
                    var path = Marshal.PtrToStringUni(IntPtr.Add(detail, 4));
                    if (path is null) continue;
                    using var handle = Open(path);
                    if (!HidD_GetPreparsedData(handle, out var preparsed)) continue;
                    try { if (HidP_GetCaps(preparsed, out var caps) == 0x110000) yield return new HidInterface(path, caps.InputReportByteLength, caps.OutputReportByteLength); }
                    finally { HidD_FreePreparsedData(preparsed); }
                }
                finally { Marshal.FreeHGlobal(detail); }
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
    }

    public static bool Matches(HidInterface device, Identity identity)
    {
        using var handle = Open(device.Path);
        var attributes = new HidAttributes { Size = Marshal.SizeOf<HidAttributes>() };
        if (!HidD_GetAttributes(handle, ref attributes) || attributes.VendorId != identity.VendorId || attributes.ProductId != identity.ProductId) return false;
        if (!HidD_GetPreparsedData(handle, out var preparsed)) return false;
        HidCaps caps;
        try { if (HidP_GetCaps(preparsed, out caps) != 0x110000 || caps.UsagePage != identity.UsagePage || caps.Usage != identity.Usage) return false; }
        finally { HidD_FreePreparsedData(preparsed); }
        if (identity.Serial is null) return true;
        var serial = new byte[256];
        return HidD_GetSerialNumberString(handle, serial, serial.Length) && Encoding.Unicode.GetString(serial).TrimEnd('\0') == identity.Serial;
    }

    public static SafeFileHandle Open(string path)
    {
        var handle = CreateFile(path, GenericRead | GenericWrite, FileShare.ReadWrite, IntPtr.Zero, OpenExisting, FileFlagOverlapped, IntPtr.Zero);
        if (handle.IsInvalid) throw new IOException("Unable to open exact HID interface.");
        return handle;
    }

    private static Guid GetHidGuid() { HidD_GetHidGuid(out var guid); return guid; }

    [StructLayout(LayoutKind.Sequential)] private struct DeviceInterfaceData { public int Size; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)] private struct HidAttributes { public int Size; public ushort VendorId; public ushort ProductId; public ushort VersionNumber; }
    [StructLayout(LayoutKind.Sequential)] private struct HidCaps { public ushort Usage; public ushort UsagePage; public ushort InputReportByteLength; public ushort OutputReportByteLength; public ushort FeatureReportByteLength; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved; public ushort NumberLinkCollectionNodes; public ushort NumberInputButtonCaps; public ushort NumberInputValueCaps; public ushort NumberInputDataIndices; public ushort NumberOutputButtonCaps; public ushort NumberOutputValueCaps; public ushort NumberOutputDataIndices; public ushort NumberFeatureButtonCaps; public ushort NumberFeatureValueCaps; public ushort NumberFeatureDataIndices; }

    [DllImport("hid.dll")] private static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll")] private static extern bool HidD_GetAttributes(SafeFileHandle device, ref HidAttributes attributes);
    [DllImport("hid.dll")] private static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr data);
    [DllImport("hid.dll")] private static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] private static extern bool HidD_GetSerialNumberString(SafeFileHandle device, byte[] buffer, int length);
    [DllImport("hid.dll")] private static extern int HidP_GetCaps(IntPtr data, out HidCaps caps);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, string? enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)] private static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr data, ref Guid guid, uint index, ref DeviceInterfaceData interfaceData);
    [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref DeviceInterfaceData interfaceData, IntPtr detail, uint size, out uint required, IntPtr deviceData);
    [DllImport("setupapi.dll")] private static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string path, uint access, FileShare share, IntPtr security, uint creation, uint flags, IntPtr template);
}
