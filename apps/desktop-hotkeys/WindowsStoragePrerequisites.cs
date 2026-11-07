using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class ReviewedInputStager
{
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(SafeFileHandle token, int informationClass, [Out] byte[] information, uint length, out uint returned);

    // TOKEN_QUERY only. This path never enables or assigns a privilege and
    // never opens a disk, volume, service, policy database or guest.
    internal static object StoragePrerequisites()
    {
        if (!OpenProcessToken(new IntPtr(-1), 0x8, out var raw)) throw new Win32Exception(Marshal.GetLastWin32Error());
        using var token = new SafeFileHandle(raw, true);
        if (!LookupPrivilegeValueW(null, "SeManageVolumePrivilege", out long luid)) throw new Win32Exception(Marshal.GetLastWin32Error());
        var before = new byte[4096]; var after = new byte[4096];
        try
        {
            static int Read(SafeFileHandle token, byte[] bytes)
            {
                if (!GetTokenInformation(token, 3, bytes, (uint)bytes.Length, out uint used)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (used < 4 || used > bytes.Length) throw new InvalidOperationException("native-storage-token-bound");
                uint count = BinaryPrimitives.ReadUInt32LittleEndian(bytes);
                if (count > 256 || used != 4 + count * 12) throw new InvalidOperationException("native-storage-token-shape");
                return checked((int)used);
            }
            int length = Read(token, before); bool assigned = false, enabled = false, found = false;
            for (int offset = 4; offset < length; offset += 12)
            {
                if (BinaryPrimitives.ReadInt64LittleEndian(before.AsSpan(offset)) != luid) continue;
                if (found) throw new InvalidOperationException("native-storage-token-duplicate"); found = true;
                uint attributes = BinaryPrimitives.ReadUInt32LittleEndian(before.AsSpan(offset + 8));
                assigned = (attributes & 4) == 0; enabled = assigned && (attributes & 2) != 0;
            }
            int finalLength = Read(token, after);
            if (length != finalLength || !before.AsSpan(0, length).SequenceEqual(after.AsSpan(0, finalLength))) throw new InvalidOperationException("native-storage-token-changed");
            return new { schema = "switchyard-windows-storage-prerequisites/v1", privilegeAssigned = assigned, privilegeEnabled = enabled,
                privilegeStateUnchanged = true, requiresPrivilegedSetup = !assigned, brokerImplemented = false, effectStarted = false, sandboxEnforced = false };
        }
        finally { CryptographicOperations.ZeroMemory(before); CryptographicOperations.ZeroMemory(after); }
    }
}
