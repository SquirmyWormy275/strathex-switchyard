using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

[SupportedOSPlatform("windows")]
internal static class RuntimePrivatePipeProof
{
    internal static int CompletedChecks { get; private set; }
    internal static string Phase { get; private set; } = "not-started";
    internal static object? DescriptorObservation { get; private set; }
    internal static int Run()
    {
        CompletedChecks = 0; Phase = "descriptor-refusals";
        void Require(bool value) { if (!value) throw new InvalidOperationException("Private pipe proof failed."); CompletedChecks++; }
        void Refuses(byte[] bytes, string user)
        {
            try { RuntimePrivatePipeSecurity.VerifyDescriptor(bytes, user); }
            catch (Exception error) when (error is InvalidOperationException or ArgumentException) { CompletedChecks++; return; }
            throw new InvalidOperationException("An unrelated or broader pipe descriptor was accepted.");
        }
        byte[] Bytes(RawSecurityDescriptor descriptor) { var result = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(result, 0); return result; }
        const string user = "S-1-5-21-1-2-3-1000", other = "S-1-5-21-1-2-3-1001";
        string good = $"O:{user}D:P(A;;0x12019f;;;{user})";
        RuntimePrivatePipeSecurity.VerifyDescriptor(Bytes(new(good)), user); CompletedChecks++;
        foreach (string changed in new[] {
            $"O:{other}D:P(A;;0x12019f;;;{user})", $"O:{user}D:P", $"O:{user}D:NO_ACCESS_CONTROL",
            $"O:{user}D:P(A;;0x1f01ff;;;{user})", $"O:{user}D:P(A;;0x12019f;;;{other})",
            good + "(A;;GR;;;WD)", good + $"(A;;0x12019f;;;{user})", $"O:{user}D:P(D;;0x12019f;;;{user})",
            $"O:{user}D:P(A;OI;0x12019f;;;{user})", $"O:{user}D:(A;;0x12019f;;;{user})", $"O:{user}D:P(A;;0x120089;;;{user})"
        }) Refuses(Bytes(new(changed)), user);
        var callback = new RawSecurityDescriptor(good);
        callback.DiscretionaryAcl![0] = new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x12019f, new SecurityIdentifier(user), true, Array.Empty<byte>());
        Refuses(Bytes(callback), user); Refuses(Array.Empty<byte>(), user); Refuses(new byte[4097], user);
        Phase = "descriptor-create";
        using var descriptor = new RuntimePrivatePipeSecurity();
        for (byte index = 1; index <= 3; index++)
        {
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = descriptor.Descriptor, Inherit = true };
            Phase = "pipe-create";
            if (!CreatePipe(out var read, out var write, ref attributes, 0)) throw new InvalidOperationException("The exact proof pipe did not open.");
            var input = new SafeFileHandle(read, true); var output = new SafeFileHandle(write, true);
            try
            {
                Phase = "descriptor-readback";
                descriptor.Verify(read, value => DescriptorObservation = value); CompletedChecks++; descriptor.Verify(write, value => DescriptorObservation = value); CompletedChecks++;
                Phase = "default-dacl";
                descriptor.VerifyDefaultDaclUnchanged(); CompletedChecks++;
                Phase = "transfer";
                Require(WriteFile(output, new[] { index }, 1, out uint sent, IntPtr.Zero) && sent == 1);
                byte[] value = new byte[1]; Require(ReadFile(input, value, 1, out uint received, IntPtr.Zero) && received == 1 && value[0] == index);
            }
            finally { input.Dispose(); output.Dispose(); }
            Phase = "handle-closure";
            Require(input.IsClosed); Require(output.IsClosed);
        }
        Phase = "complete"; return CompletedChecks;
    }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes security, uint bytes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteFile(SafeFileHandle handle, byte[] bytes, uint length, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(SafeFileHandle handle, [Out] byte[] bytes, uint length, out uint read, IntPtr overlapped);
}
