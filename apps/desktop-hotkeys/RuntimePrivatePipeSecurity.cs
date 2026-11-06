using System.Runtime.InteropServices;
using System.ComponentModel;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

// A descriptor for newly created anonymous command pipes only. The primary
// token is opened for QUERY; its default DACL is observed, never modified.
internal sealed class RuntimePrivatePipeSecurity : IDisposable
{
    private const int PipeAccess = 0x12019f; // FILE_GENERIC_READ | FILE_GENERIC_WRITE
    private readonly SafeAccessTokenHandle token;
    private readonly string user;
    private readonly byte[] defaultDacl;
    private readonly int descriptorBytes;
    internal IntPtr Descriptor { get; private set; }
    private static Exception Invalid() => new InvalidOperationException("The private command pipe security did not verify.");

    internal RuntimePrivatePipeSecurity()
    {
        if (!OperatingSystem.IsWindows()) throw Invalid();
        if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) { token.Dispose(); throw Invalid(); }
        try
        {
            user = ReadToken(1, (memory, length) =>
            {
                if (!OperatingSystem.IsWindows()) throw Invalid();
                IntPtr sid = Marshal.ReadIntPtr(memory);
                RequireRange(memory, length, sid, 8);
                if (!IsValidSid(sid)) throw Invalid();
                uint bytes = GetLengthSid(sid);
                if (bytes is < 8 or > 68) throw Invalid();
                RequireRange(memory, length, sid, bytes);
                return new SecurityIdentifier(sid).Value;
            });
            defaultDacl = ReadDefaultDacl();
            // Explicit individual pipe rights, with no WRITE_DAC/WRITE_OWNER,
            // deletion, Everyone, anonymous, administrators or system ACE.
            var security = new RawSecurityDescriptor($"O:{user}D:P(A;;0x{PipeAccess:x};;;{user})");
            byte[] bytes = new byte[security.BinaryLength];
            try
            {
                security.GetBinaryForm(bytes, 0);
                descriptorBytes = bytes.Length;
                Descriptor = Marshal.AllocHGlobal(descriptorBytes);
                Marshal.Copy(bytes, 0, Descriptor, descriptorBytes);
            }
            finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        catch { Dispose(); throw; }
    }

    internal void Verify(IntPtr pipe, Action<object>? observe = null)
    {
        if (!OperatingSystem.IsWindows() || Descriptor == IntPtr.Zero || pipe == IntPtr.Zero || pipe == new IntPtr(-1)) throw Invalid();
        byte[] bytes = new byte[4096];
        try
        {
            // OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION. The
            // returned pipe handles already include READ_CONTROL.
            if (!GetKernelObjectSecurity(pipe, 5, bytes, checked((uint)bytes.Length), out uint length)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (length is < 20 or > 4096) throw Invalid();
            byte[] exact = bytes.AsSpan(0, checked((int)length)).ToArray();
            try { VerifyDescriptor(exact, user, observe); }
            finally { CryptographicOperations.ZeroMemory(exact); }
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    internal static void VerifyDescriptor(byte[] bytes, string user, Action<object>? observe = null)
    {
        if (!OperatingSystem.IsWindows() || bytes.Length is < 20 or > 4096) throw Invalid();
        var security = new RawSecurityDescriptor(bytes, 0);
        if (observe is not null)
        {
            var one = security.DiscretionaryAcl?.Count == 1 ? security.DiscretionaryAcl[0] as CommonAce : null;
            observe(new { ownerMatches = security.Owner?.Value == user, controlFlags = (int)security.ControlFlags,
                aceCount = security.DiscretionaryAcl?.Count, singleMask = one?.AccessMask, singleFlags = one is null ? (int?)null : (int)one.AceFlags,
                singleAllowed = one?.AceQualifier == AceQualifier.AccessAllowed, singleCallback = one?.IsCallback, singleUserMatches = one?.SecurityIdentifier.Value == user });
        }
        if (security.Owner?.Value != user || security.DiscretionaryAcl?.Count != 1
            || (security.ControlFlags & (ControlFlags.DiscretionaryAclPresent | ControlFlags.DiscretionaryAclProtected)) != (ControlFlags.DiscretionaryAclPresent | ControlFlags.DiscretionaryAclProtected)
            || security.DiscretionaryAcl[0] is not CommonAce ace || ace.AceQualifier != AceQualifier.AccessAllowed
            || ace.IsCallback || ace.AceFlags != AceFlags.None || ace.AccessMask != PipeAccess || ace.SecurityIdentifier.Value != user) throw Invalid();
    }

    internal void VerifyDefaultDaclUnchanged()
    {
        byte[] current = ReadDefaultDacl();
        try { if (!CryptographicOperations.FixedTimeEquals(defaultDacl, current)) throw Invalid(); }
        finally { CryptographicOperations.ZeroMemory(current); }
    }

    private byte[] ReadDefaultDacl() => ReadToken(6, (memory, length) =>
    {
        IntPtr acl = Marshal.ReadIntPtr(memory);
        if (acl == IntPtr.Zero) return Array.Empty<byte>();
        RequireRange(memory, length, acl, 8);
        uint bytes = unchecked((ushort)Marshal.ReadInt16(acl, 2));
        if (bytes < 8) throw Invalid();
        RequireRange(memory, length, acl, bytes);
        byte[] copy = new byte[bytes]; Marshal.Copy(acl, copy, 0, copy.Length); return copy;
    });

    private T ReadToken<T>(int informationClass, Func<IntPtr, uint, T> read)
    {
        if (GetTokenInformation(token, informationClass, IntPtr.Zero, 0, out uint size) || Marshal.GetLastWin32Error() != 122 || size < IntPtr.Size || size > 65536) throw Invalid();
        IntPtr memory = Marshal.AllocHGlobal(checked((int)size));
        try
        {
            if (!GetTokenInformation(token, informationClass, memory, size, out uint returned) || returned < IntPtr.Size || returned > size) throw Invalid();
            return read(memory, returned);
        }
        finally { Clear(memory, checked((int)size)); Marshal.FreeHGlobal(memory); }
    }
    private static void RequireRange(IntPtr memory, uint length, IntPtr value, uint bytes)
    {
        long offset = value.ToInt64() - memory.ToInt64();
        if (offset < 0 || offset > length || bytes > length - offset) throw Invalid();
    }
    private static void Clear(IntPtr memory, int bytes) { for (int i = 0; i < bytes; i++) Marshal.WriteByte(memory, i, 0); }
    public void Dispose()
    {
        if (Descriptor != IntPtr.Zero) { Clear(Descriptor, descriptorBytes); Marshal.FreeHGlobal(Descriptor); Descriptor = IntPtr.Zero; }
        if (defaultDacl is not null) CryptographicOperations.ZeroMemory(defaultDacl);
        token.Dispose();
    }

    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process, uint access, out SafeAccessTokenHandle token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetTokenInformation(SafeAccessTokenHandle token, int informationClass, IntPtr information, uint bytes, out uint required);
    [DllImport("advapi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsValidSid(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern uint GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetKernelObjectSecurity(IntPtr handle, uint information, [Out] byte[] descriptor, uint bytes, out uint required);
}
