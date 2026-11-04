using System.Runtime.InteropServices;
using System.Runtime.Versioning;

// The production observation's P/Invokes normally live in the larger input
// stager. This proof links the unchanged query without the disk-effect code.
[SupportedOSPlatform("windows")]
internal static partial class ReviewedInputStager
{
    [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValueW(string? system,string name,out long luid);
}
