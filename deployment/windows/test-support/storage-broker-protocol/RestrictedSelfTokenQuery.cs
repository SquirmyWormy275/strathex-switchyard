using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static partial class NativeRestrictedHostProof
{
    private sealed class SelfQueryEvidence(string childScope)
    {
        public string schema { get; } = "switchyard-child-self-query-acl/v1";
        public string scope { get; } = childScope;
        public string status { get; set; } = "reserved";
        public uint grantedMask { get; } = 8;
        public bool changeRequested { get; set; }
        public string? beforeAclSha256 { get; set; }
        public string? afterAclSha256 { get; set; }
        public bool originalAcesPreserved { get; set; }
        public bool exactQueryEntryVerified { get; set; }
        public bool tokenRestrictionsRechecked { get; set; }
        public bool handlesClosedVerified { get; set; }
        public bool buffersClearedVerified { get; set; }
    }
    private static readonly List<SelfQueryEvidence> SelfQueryObservations = new();
    internal static object SelfTokenQueryAclDiagnostic => SelfQueryObservations.ToArray();
    private static bool SelfTokenQueryAccessVerified;
    private static byte[] AclBytes(RawAcl acl) { byte[] bytes = new byte[acl.BinaryLength]; acl.GetBinaryForm(bytes, 0); return bytes; }

    // CI-only correction of the observed suspended-child token object DACL.
    // Add only TOKEN_QUERY for the existing user. Never modify token groups,
    // privileges, default DACL, source account or another securable object.
    private static void PermitOwnTokenQuery(SafeFileHandle child, string user, string scope)
    {
        Require(scope is "cold-probe" or "node-owner" && SelfQueryObservations.Count < 2 && !SelfQueryObservations.Any(e => e.scope == scope));
        ApplyOwnTokenQuery(child, user, scope, evidence => SelfQueryObservations.Add(evidence));
    }
    private static void ApplyOwnTokenQuery(SafeFileHandle child, string user, string scope, Action<SelfQueryEvidence> reserve)
    {
        Require(scope is "cold-probe" or "node-owner" or "lease-no-window" or "lease-detached" or "descendant-guardian" or "descendant-worker" or "descendant-status");
        var evidence = new SelfQueryEvidence(scope); reserve(evidence);
        byte[] beforeBuffer = new byte[16384], afterBuffer = new byte[16384], changedBuffer = Array.Empty<byte>(), originalAcl = Array.Empty<byte>(), expectedAcl = Array.Empty<byte>(), observedAcl = Array.Empty<byte>();
        SafeAccessTokenHandle? control = null;
        try
        {
            bool opened = OpenProcessToken(child.DangerousGetHandle(), 0x60008, out var openedToken); control = openedToken; Native(opened);
            VerifyToken(control, user, recordHistory: false);
            Native(GetKernelObjectSecurity(control.DangerousGetHandle(), 5, beforeBuffer, (uint)beforeBuffer.Length, out uint needed)); Require(needed is >= 20 and <= 16384);
            var before = new RawSecurityDescriptor(beforeBuffer, 0); var acl = before.DiscretionaryAcl;
            Require(before.Owner?.Value == user && acl != null && acl.Count is 3 or 4 && before.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclPresent));
            // Accept only the exact baseline observed in the source-bound CI
            // receipt, or that baseline plus this exact query-only entry.
            string[] principals = { "administrators", "system", "logon" }; int[] masks = { 0xf01ff, 0xf01ff, 0x2001f };
            for (int i = 0; i < 3; i++) Require(acl![i] is CommonAce ace && !ace.IsCallback && ace.AceQualifier == AceQualifier.AccessAllowed && ace.AceFlags == AceFlags.None && ace.AccessMask == masks[i] && PrincipalClass(ace.SecurityIdentifier.Value, user) == principals[i]);
            if (acl!.Count == 4) Require(acl[3] is CommonAce own && !own.IsCallback && own.AceQualifier == AceQualifier.AccessAllowed && own.AceFlags == AceFlags.None && own.AccessMask == 8 && own.SecurityIdentifier.Value == user);
            originalAcl = AclBytes(acl); evidence.beforeAclSha256 = Convert.ToHexString(SHA256.HashData(originalAcl)).ToLowerInvariant();
            var expected = new RawSecurityDescriptor(beforeBuffer, 0);
            if (acl.Count == 3) expected.DiscretionaryAcl!.InsertAce(3, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 8, new SecurityIdentifier(user), false, null));
            expectedAcl = AclBytes(expected.DiscretionaryAcl!);
            if (acl.Count == 3)
            {
                changedBuffer = new byte[expected.BinaryLength]; expected.GetBinaryForm(changedBuffer, 0);
                evidence.status = "apply-requested"; evidence.changeRequested = true;
                Native(SetKernelObjectSecurity(control.DangerousGetHandle(), 4, changedBuffer));
            }
            evidence.status = "readback";
            Native(GetKernelObjectSecurity(control.DangerousGetHandle(), 5, afterBuffer, (uint)afterBuffer.Length, out needed)); Require(needed is >= 20 and <= 16384);
            var after = new RawSecurityDescriptor(afterBuffer, 0); Require(after.Owner?.Value == before.Owner?.Value && after.ControlFlags == before.ControlFlags && after.DiscretionaryAcl != null);
            observedAcl = AclBytes(after.DiscretionaryAcl!); Require(observedAcl.SequenceEqual(expectedAcl));
            evidence.afterAclSha256 = Convert.ToHexString(SHA256.HashData(observedAcl)).ToLowerInvariant();
            evidence.originalAcesPreserved = true; evidence.exactQueryEntryVerified = true;
            VerifyToken(control, user, recordHistory: false); evidence.tokenRestrictionsRechecked = true;
            evidence.status = "verified";
        }
        finally
        {
            control?.Dispose(); evidence.handlesClosedVerified = control == null || control.IsClosed;
            foreach (byte[] buffer in new[] { beforeBuffer, afterBuffer, changedBuffer, originalAcl, expectedAcl, observedAcl }) Array.Clear(buffer);
            evidence.buffersClearedVerified = new[] { beforeBuffer, afterBuffer, changedBuffer, originalAcl, expectedAcl, observedAcl }.All(buffer => buffer.All(b => b == 0));
        }
        Require(evidence.status == "verified" && evidence.handlesClosedVerified && evidence.buffersClearedVerified);
    }
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetKernelObjectSecurity(IntPtr handle, uint information, [In] byte[] descriptor);
}
