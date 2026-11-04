using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32.SafeHandles;

// Produces a new data file, never a device, mount or existing filesystem.
// Fixed VHD 1.0 and FAT16 layouts follow the published Microsoft specifications.
internal static class BoundedExchangeImage
{
    [StructLayout(LayoutKind.Sequential)] private struct StorageType { public uint DeviceId; public Guid Vendor; }
    [StructLayout(LayoutKind.Sequential)] private struct OpenParameters { public uint Version, ReadWriteDepth; }
    [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)]
    private static extern uint OpenVirtualDisk(ref StorageType type, string path, uint access, uint flags, ref OpenParameters parameters, out IntPtr handle);
    [DllImport("virtdisk.dll")]
    private static extern uint GetVirtualDiskInformation(SafeFileHandle handle, ref uint length, [In, Out] byte[] information, out uint used);
    public const long VirtualBytes = 64L * 1024 * 1024;
    public const long BackingBytes = VirtualBytes + 512;
    public const int PartitionSector = 2048;
    public const int PartitionSectors = (int)(VirtualBytes / 512) - PartitionSector;
    private const int FatSectors = 128, RootEntries = 512, RootSectors = RootEntries * 32 / 512;
    private static readonly byte[] Label = Encoding.ASCII.GetBytes("SWITCHYARD  ");

    private static void Le16(byte[] value, int offset, ushort number) => BinaryPrimitives.WriteUInt16LittleEndian(value.AsSpan(offset, 2), number);
    private static void Le32(byte[] value, int offset, uint number) => BinaryPrimitives.WriteUInt32LittleEndian(value.AsSpan(offset, 4), number);
    private static void Be32(byte[] value, int offset, uint number) => BinaryPrimitives.WriteUInt32BigEndian(value.AsSpan(offset, 4), number);
    private static void Be64(byte[] value, int offset, ulong number) => BinaryPrimitives.WriteUInt64BigEndian(value.AsSpan(offset, 8), number);
    private static void Text(byte[] value, int offset, string text) => Encoding.ASCII.GetBytes(text).CopyTo(value, offset);
    private static byte[] Sector() { var value = new byte[512]; value[510] = 0x55; value[511] = 0xaa; return value; }

    private static byte[] MasterBootRecord(Guid id)
    {
        var value = Sector(); id.ToByteArray().AsSpan(0, 4).CopyTo(value.AsSpan(440, 4));
        // One non-bootable FAT16 partition, with LBA offsets authoritative.
        value[447] = 0xfe; value[448] = 0xff; value[449] = 0xff; value[450] = 0x0e;
        value[451] = 0xfe; value[452] = 0xff; value[453] = 0xff;
        Le32(value, 454, PartitionSector); Le32(value, 458, PartitionSectors);
        return value;
    }
    private static byte[] BootRecord(Guid id)
    {
        var value = Sector(); value[0] = 0xeb; value[1] = 0x3c; value[2] = 0x90; Text(value, 3, "MSWIN4.1");
        Le16(value, 11, 512); value[13] = 4; Le16(value, 14, 1); value[16] = 2; Le16(value, 17, RootEntries);
        value[21] = 0xf8; Le16(value, 22, FatSectors); Le16(value, 24, 17); Le16(value, 26, 8);
        Le32(value, 28, PartitionSector); Le32(value, 32, PartitionSectors); value[36] = 0x80; value[38] = 0x29;
        id.ToByteArray().AsSpan(0, 4).CopyTo(value.AsSpan(39, 4)); Label.CopyTo(value, 43); Text(value, 54, "FAT16   ");
        value[62] = 0xeb; value[63] = 0xfe; // Never boot this data-only volume.
        return value;
    }
    private static byte[] Footer(Guid id)
    {
        var value = new byte[512]; Text(value, 0, "conectix"); Be32(value, 8, 2); Be32(value, 12, 0x10000); Be64(value, 16, ulong.MaxValue);
        Be32(value, 24, checked((uint)(DateTimeOffset.UtcNow - new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero)).TotalSeconds));
        Text(value, 28, "SWYD"); Be32(value, 32, 0x10000); Text(value, 36, "Wi2k"); Be64(value, 40, VirtualBytes); Be64(value, 48, VirtualBytes);
        // Microsoft VHD CHS algorithm for this fixed 131072-sector geometry.
        BinaryPrimitives.WriteUInt16BigEndian(value.AsSpan(56, 2), 963); value[58] = 8; value[59] = 17; Be32(value, 60, 2);
        id.ToByteArray(bigEndian: true).CopyTo(value, 68); Be32(value, 64, ~value.Aggregate(0U, (sum, next) => sum + next));
        return value;
    }
    public static void WriteNew(Stream image, Guid operationId)
    {
        if (!image.CanRead || !image.CanWrite || !image.CanSeek || image.Length != 0 || operationId == Guid.Empty) throw new InvalidOperationException("Create only a new empty bounded exchange data file.");
        var zero = new byte[1024 * 1024]; image.Position = 0;
        for (long written = 0; written < VirtualBytes; written += zero.Length) image.Write(zero);
        image.Write(Footer(operationId));
        void Put(long offset, byte[] bytes) { image.Position = offset; image.Write(bytes); }
        Put(0, MasterBootRecord(operationId)); Put(PartitionSector * 512L, BootRecord(operationId));
        var fat = new byte[512]; fat[0] = 0xf8; fat[1] = 0xff; fat[2] = 0xff; fat[3] = 0xff;
        Put((PartitionSector + 1L) * 512, fat); Put((PartitionSector + 1L + FatSectors) * 512, fat);
        var root = new byte[512]; Label.CopyTo(root, 0); root[11] = 0x08;
        Put((PartitionSector + 1L + 2 * FatSectors) * 512, root);
        if (image.Length != BackingBytes) throw new InvalidOperationException("The bounded exchange image size changed.");
        image.Flush(); Validate(image, operationId);
    }
    public static string Validate(Stream image, Guid operationId)
    {
        if (!image.CanRead || !image.CanSeek || image.Length != BackingBytes || operationId == Guid.Empty) throw new InvalidOperationException("The exact fixed-size exchange image is unavailable.");
        byte[] Read(long offset, int length) { var bytes = new byte[length]; image.Position = offset; image.ReadExactly(bytes); return bytes; }
        var footer = Read(VirtualBytes, 512); var id = operationId.ToByteArray(bigEndian: true);
        uint checksum = BinaryPrimitives.ReadUInt32BigEndian(footer.AsSpan(64, 4)); var sumBytes = (byte[])footer.Clone(); Array.Clear(sumBytes, 64, 4);
        if (!footer.AsSpan(0, 8).SequenceEqual("conectix"u8) || BinaryPrimitives.ReadUInt32BigEndian(footer.AsSpan(8, 4)) != 2 || BinaryPrimitives.ReadUInt32BigEndian(footer.AsSpan(12, 4)) != 0x10000
            || BinaryPrimitives.ReadUInt64BigEndian(footer.AsSpan(16, 8)) != ulong.MaxValue || BinaryPrimitives.ReadUInt64BigEndian(footer.AsSpan(40, 8)) != VirtualBytes || BinaryPrimitives.ReadUInt64BigEndian(footer.AsSpan(48, 8)) != VirtualBytes
            || BinaryPrimitives.ReadUInt32BigEndian(footer.AsSpan(60, 4)) != 2 || !footer.AsSpan(68, 16).SequenceEqual(id) || footer.AsSpan(84).IndexOfAnyExcept((byte)0) >= 0
            || !footer.AsSpan(28, 4).SequenceEqual("SWYD"u8) || BinaryPrimitives.ReadUInt32BigEndian(footer.AsSpan(32, 4)) != 0x10000 || !footer.AsSpan(36, 4).SequenceEqual("Wi2k"u8)
            || BinaryPrimitives.ReadUInt16BigEndian(footer.AsSpan(56, 2)) != 963 || footer[58] != 8 || footer[59] != 17
            || checksum != ~sumBytes.Aggregate(0U, (sum, next) => sum + next)) throw new InvalidOperationException("The exact fixed VHD identity, capacity or footer checksum changed.");
        if (!Read(0, 512).AsSpan().SequenceEqual(MasterBootRecord(operationId)) || !Read(PartitionSector * 512L, 512).AsSpan().SequenceEqual(BootRecord(operationId))) throw new InvalidOperationException("The fixed exchange partition geometry changed.");
        const int clusters = (PartitionSectors - 1 - 2 * FatSectors - RootSectors) / 4;
        if (clusters < 4085 || clusters >= 65525 || (clusters + 2) * 2 > FatSectors * 512) throw new InvalidOperationException("The exchange FAT16 capacity is invalid.");
        return Convert.ToHexString(SHA256.HashData(footer)).ToLowerInvariant();
    }
    [SupportedOSPlatform("windows")]
    public static void ReadNativeHeader(string path, Guid operationId)
    {
        var storage = new StorageType { DeviceId = 2, Vendor = new Guid("ec984aec-a0f9-47e9-901f-71415a66345b") };
        var parameters = new OpenParameters { Version = 1, ReadWriteDepth = 0 };
        // GET_INFO only, zero writable backing-store depth; never attach.
        uint error = OpenVirtualDisk(ref storage, path, 0x00080000, 0, ref parameters, out var nativeHandle);
        if (error != 0) throw new System.ComponentModel.Win32Exception(checked((int)error));
        using (var handle = new SafeFileHandle(nativeHandle, ownsHandle: true))
        {
            if (handle.IsInvalid) throw new InvalidOperationException("The native VHD reader returned no valid metadata handle.");
            byte[] Read(uint version, uint minimum)
            {
                var bytes = new byte[32]; BinaryPrimitives.WriteUInt32LittleEndian(bytes, version); uint length = 32;
                uint result = GetVirtualDiskInformation(handle, ref length, bytes, out uint used);
                if (result != 0) throw new System.ComponentModel.Win32Exception(checked((int)result));
                if (used < minimum || used > bytes.Length) throw new InvalidOperationException($"native-vhd-layout-{version}-{used}-{length}");
                return bytes;
            }
            var size = Read(1, 32); var identifier = Read(2, 24); var subtype = Read(7, 12); var loaded = Read(13, 12);
            ulong nativeSize = BinaryPrimitives.ReadUInt64LittleEndian(size.AsSpan(8, 8)); uint nativeSector = BinaryPrimitives.ReadUInt32LittleEndian(size.AsSpan(28, 4)), nativeType = BinaryPrimitives.ReadUInt32LittleEndian(subtype.AsSpan(8, 4)), nativeLoaded = BinaryPrimitives.ReadUInt32LittleEndian(loaded.AsSpan(8, 4));
            if (nativeSize != VirtualBytes) throw new InvalidOperationException($"native-vhd-size-{nativeSize}");
            if (nativeSector != 512) throw new InvalidOperationException($"native-vhd-sector-{nativeSector}");
            // The VHD UUID is an opaque network-order byte sequence. The native
            // GUID output retains those bytes; formatting it as a CLR GUID
            // would reverse its first three fields and change the comparison.
            if (!identifier.AsSpan(8, 16).SequenceEqual(operationId.ToByteArray(bigEndian: true))) throw new InvalidOperationException("native-vhd-identifier-other");
            if (nativeType != 2) throw new InvalidOperationException($"native-vhd-type-{nativeType}");
            if (nativeLoaded != 0) throw new InvalidOperationException($"native-vhd-loaded-{nativeLoaded}");
        }
    }
}
