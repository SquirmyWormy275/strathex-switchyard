using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

// Test-only fixed API observation. No output entropy, token changes or RNG fallback.
[SupportedOSPlatform("windows")]
internal static class RestrictedRandomAccess
{
    internal sealed record Entry(string token, uint systemStatus, uint providerOpenStatus, uint? providerStatus, uint? providerCloseStatus);
    internal sealed record Evidence(string schema, bool handlesClosedVerified, bool buffersClearedVerified, Entry[] entries);
    internal static Evidence Capture(SafeAccessTokenHandle creator, SafeAccessTokenHandle restricted)
    {
        // Probe the restricted token first; each explicit provider handle is
        // opened, used and closed under the same impersonated token.
        var first = WindowsIdentity.RunImpersonated(restricted, () => Read("restricted"));
        var second = WindowsIdentity.RunImpersonated(creator, () => Read("creator"));
        return new("switchyard-restricted-random-access/v1", true, true, new[] { first, second });
    }
    private static Entry Read(string token)
    {
        var buffer = new byte[32]; IntPtr provider = IntPtr.Zero; uint? generated = null, closed = null;
        try
        {
            uint system = BCryptGenRandom(IntPtr.Zero, buffer, (uint)buffer.Length, 2);
            Array.Clear(buffer);
            uint opened = BCryptOpenAlgorithmProvider(out provider, "RNG", "Microsoft Primitive Provider", 0);
            try
            {
                if (opened == 0)
                {
                    if (provider == IntPtr.Zero) throw new InvalidOperationException("The native random provider returned no handle.");
                    generated = BCryptGenRandom(provider, buffer, (uint)buffer.Length, 0);
                }
                else if (provider != IntPtr.Zero) throw new InvalidOperationException("A failed native random provider returned an unfamiliar handle.");
            }
            finally
            {
                if (provider != IntPtr.Zero)
                {
                    closed = BCryptCloseAlgorithmProvider(provider, 0); provider = IntPtr.Zero;
                    if (closed != 0) throw new InvalidOperationException("The exact random provider handle did not verify closure.");
                }
            }
            return new(token, system, opened, generated, closed);
        }
        finally
        {
            Array.Clear(buffer);
            if (buffer.Any(value => value != 0)) throw new InvalidOperationException("The diagnostic random buffer was not cleared.");
        }
    }
    [DllImport("bcrypt.dll")] private static extern uint BCryptGenRandom(IntPtr algorithm, byte[] buffer, uint length, uint flags);
    [DllImport("bcrypt.dll", CharSet = CharSet.Unicode)] private static extern uint BCryptOpenAlgorithmProvider(out IntPtr algorithm, string id, string implementation, uint flags);
    [DllImport("bcrypt.dll")] private static extern uint BCryptCloseAlgorithmProvider(IntPtr algorithm, uint flags);
}
