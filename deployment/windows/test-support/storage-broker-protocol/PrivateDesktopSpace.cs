using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

// Test assembly only. No interactive desktop ACL or persistent configuration is changed.
[SupportedOSPlatform("windows")]
internal sealed class PrivateDesktopSpace : IDisposable
{
    private IntPtr station, desktop;
    internal string Name { get; }
    private static void Native(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    internal PrivateDesktopSpace(string user)
    {
        string stationName = "SwitchyardProof" + Guid.NewGuid().ToString("N");
        Name = stationName + "\\default";
        // Only the exact same user and SYSTEM receive access. An explicit medium
        // label lets the verified medium token initialize its own USER objects.
        // Neither administrators, other users nor the interactive desktop gain rights.
        Native(ConvertStringSecurityDescriptorToSecurityDescriptorW("O:" + user + "D:P(A;;GA;;;SY)(A;;GA;;;" + user + ")S:(ML;;NW;;;ME)", 1, out var descriptor, out _));
        try
        {
            var security = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = descriptor, Inherit = false };
            station = CreateWindowStationW(stationName, 0, 0x000F037F, ref security); int stationStatus = Marshal.GetLastWin32Error(); Native(station != IntPtr.Zero);
            if (stationStatus == 183) throw new InvalidOperationException("The private station already exists; preserve its original owner.");
            IntPtr original = GetProcessWindowStation(); Native(original != IntPtr.Zero);
            try
            {
                // This is a process-local namespace switch solely to create the
                // private desktop. No thread or interactive input desktop switches.
                Native(SetProcessWindowStation(station));
                desktop = CreateDesktopW("default", null, IntPtr.Zero, 0, 0x000F01FF, ref security); int desktopStatus = Marshal.GetLastWin32Error(); Native(desktop != IntPtr.Zero);
                if (desktopStatus == 183) throw new InvalidOperationException("The private desktop already exists; preserve its original owner.");
            }
            finally { Native(SetProcessWindowStation(original)); }
        }
        catch { Dispose(); throw; }
        finally { Native(LocalFree(descriptor) == IntPtr.Zero); }
    }

    public void Dispose()
    {
        int error = 0; bool failed = false;
        if (desktop != IntPtr.Zero) { if (CloseDesktop(desktop)) desktop = IntPtr.Zero; else { failed = true; error = Marshal.GetLastWin32Error(); } }
        if (station != IntPtr.Zero) { if (CloseWindowStation(station)) station = IntPtr.Zero; else { failed = true; if (error == 0) error = Marshal.GetLastWin32Error(); } }
        if (failed) throw new Win32Exception(error);
    }

    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowStationW(string name, uint flags, uint access, ref SecurityAttributes security);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateDesktopW(string name, string? device, IntPtr mode, uint flags, uint access, ref SecurityAttributes security);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetProcessWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseWindowStation(IntPtr station);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseDesktop(IntPtr desktop);
}
