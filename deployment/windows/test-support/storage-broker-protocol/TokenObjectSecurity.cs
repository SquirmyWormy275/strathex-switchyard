using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class NativeRestrictedHostProof
{
    private sealed record TokenAce(string kind, byte flags, uint mask, string principal);
    private sealed record TokenSecurityEvidence(string schema, string scope, string stage, uint error, string? ownerClass, bool? daclPresent, bool? nullDacl, bool? daclProtected, TokenAce[] entries, bool handlesClosedVerified, bool buffersClearedVerified);
    private static readonly List<TokenSecurityEvidence> TokenSecurityObservations = new();
    internal static object TokenObjectSecurityDiagnostic => TokenSecurityObservations.ToArray();
    private static string PrincipalClass(string? sid, string user)
    {
        if (sid == null) return "absent";
        if (sid == user) return "current-user";
        return sid switch {
            "S-1-5-18" => "system", "S-1-5-32-544" => "administrators",
            "S-1-1-0" => "everyone", "S-1-5-11" => "authenticated-users", "S-1-5-32-545" => "users",
            _ => System.Text.RegularExpressions.Regex.IsMatch(sid, @"^S-1-5-5-[0-9]{1,10}-[0-9]{1,10}$") ? "logon" : "other"
        };
    }
    // Parent-side, read-only descriptor observation of each actual suspended
    // child token. It neither requests WRITE_DAC nor modifies a token or ACL.
    private static void CaptureTokenObjectSecurity(SafeFileHandle child, string user, string scope)
    {
        Require(scope is "cold-probe" or "node-owner" && TokenSecurityObservations.Count < 2 && !TokenSecurityObservations.Any(e => e.scope == scope));
        byte[] buffer = new byte[16384]; IntPtr token = IntPtr.Zero;
        string stage = "open"; uint error = 0; string? owner = null; bool? present = null, nullDacl = null, protection = null;
        TokenAce[] entries = Array.Empty<TokenAce>(); bool closed = true;
        try
        {
            if (!OpenTokenSecurity(child.DangerousGetHandle(), 0x20008, out token)) error = unchecked((uint)Marshal.GetLastWin32Error());
            else
            {
                stage = "read";
                if (!GetKernelObjectSecurity(token, 5, buffer, (uint)buffer.Length, out uint needed)) error = unchecked((uint)Marshal.GetLastWin32Error());
                else
                {
                    stage = "parse";
                    if (needed is < 20 or > 16384) throw new InvalidOperationException();
                    var security = new RawSecurityDescriptor(buffer, 0);
                    if (!security.ControlFlags.HasFlag(ControlFlags.SelfRelative) || security.DiscretionaryAcl?.Count > 64) throw new InvalidOperationException();
                    var rows = new List<TokenAce>();
                    if (security.DiscretionaryAcl != null) foreach (GenericAce entry in security.DiscretionaryAcl)
                    {
                        string kind = entry is CommonAce common ? common.AceQualifier == AceQualifier.AccessAllowed ? "allow" : common.AceQualifier == AceQualifier.AccessDenied ? "deny" : "other" : "other";
                        rows.Add(new(kind, (byte)entry.AceFlags, entry is KnownAce known ? unchecked((uint)known.AccessMask) : 0, entry is KnownAce identified ? PrincipalClass(identified.SecurityIdentifier.Value, user) : "other"));
                    }
                    owner = PrincipalClass(security.Owner?.Value, user);
                    present = security.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclPresent);
                    nullDacl = security.DiscretionaryAcl == null;
                    protection = security.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected);
                    entries = rows.ToArray(); stage = "complete";
                }
            }
        }
        catch (Exception e) when (e is ArgumentException or InvalidOperationException or OverflowException)
        {
            stage = "parse"; error = 0; owner = null; present = null; nullDacl = null; protection = null; entries = Array.Empty<TokenAce>();
        }
        finally
        {
            if (token != IntPtr.Zero) closed = CloseHandle(token);
            Array.Clear(buffer);
        }
        TokenSecurityObservations.Add(new("switchyard-child-token-security/v1", scope, stage, error, owner, present, nullDacl, protection, entries, closed, buffer.All(b => b == 0)));
    }
    [DllImport("advapi32.dll", EntryPoint = "OpenProcessToken", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenTokenSecurity(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetKernelObjectSecurity(IntPtr handle, uint information, [Out] byte[] descriptor, uint length, out uint needed);
}
