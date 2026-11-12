using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

// Test assembly only. Observe access to existing OS namespaces; never enumerate,
// create an object, change an ACL/token, or disclose a session/path/SID.
[SupportedOSPlatform("windows")]
internal static class RestrictedNamespaceAccess
{
    internal static object Capture(SafeAccessTokenHandle source, SafeAccessTokenHandle restricted)
    {
        using var process = Process.GetCurrentProcess();
        string session = $"\\Sessions\\{process.SessionId}\\BaseNamedObjects";
        var locations = new[] { (Label: "global", Path: "\\BaseNamedObjects"), (Label: "session", Path: session), (Label: "restricted-session", Path: session + "\\Restricted") };
        var access = new[] { (Label: "query-traverse", Mask: 3U), (Label: "directory-operations", Mask: 15U), (Label: "all", Mask: 0x000F000FU) };
        var entries = new List<object>();
        try
        {
            foreach (var location in locations) foreach (var requested in access)
            {
                uint creatorStatus = WindowsIdentity.RunImpersonated(source, () => Probe(location.Path, requested.Mask));
                uint restrictedStatus = WindowsIdentity.RunImpersonated(restricted, () => Probe(location.Path, requested.Mask));
                entries.Add(new { scope = location.Label, access = requested.Label, creatorStatus, restrictedStatus });
            }
            return new { schema = "switchyard-restricted-namespace-access/v1", queryStatus = "completed", handlesClosedVerified = true, entries };
        }
        catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException)
        {
            return new { schema = "switchyard-restricted-namespace-access/v1", queryStatus = "unavailable", handlesClosedVerified = true, entries = Array.Empty<object>() };
        }
    }

    private static uint Probe(string path, uint access)
    {
        IntPtr text = Marshal.StringToHGlobalUni(path), name = IntPtr.Zero, handle = IntPtr.Zero;
        try
        {
            var unicode = new UnicodeString { Length = checked((ushort)(path.Length * 2)), MaximumLength = checked((ushort)((path.Length + 1) * 2)), Buffer = text };
            name = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeString>()); Marshal.StructureToPtr(unicode, name, false);
            var attributes = new ObjectAttributes { Length = Marshal.SizeOf<ObjectAttributes>(), ObjectName = name, Attributes = 0x40 };
            uint status = NtOpenDirectoryObject(out handle, access, ref attributes);
            if ((status < 0x80000000) != (handle != IntPtr.Zero)) throw new InvalidOperationException("Namespace observation returned an inconsistent handle.");
            return status;
        }
        finally
        {
            try
            {
                if (handle != IntPtr.Zero)
                {
                    bool closed;
                    try { closed = CloseHandle(handle); }
                    catch { throw new InvalidOperationException("Namespace observation handle closure is unconfirmed."); }
                    if (!closed) throw new InvalidOperationException("Namespace observation handle did not close.");
                }
            }
            finally { if (name != IntPtr.Zero) Marshal.FreeHGlobal(name); Marshal.FreeHGlobal(text); }
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] private struct ObjectAttributes { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
    [DllImport("ntdll.dll")] private static extern uint NtOpenDirectoryObject(out IntPtr directory, uint access, ref ObjectAttributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
