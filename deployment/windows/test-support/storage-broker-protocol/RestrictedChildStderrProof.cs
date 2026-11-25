using System.Text;
using System.Text.Json;

internal static class RestrictedChildStderrProof
{
    internal static int Run()
    {
        int checks = 0;
        void Require(bool value) { if (!value) throw new InvalidOperationException("The restricted child stderr privacy proof failed."); checks++; }
        foreach (var (text, category) in new[] { ("", "empty"), ("Assertion failed at C:/NEVER_RETAIN", "assertion"), ("node::Worker C:/NEVER_RETAIN", "node-native"), ("Error: C:/NEVER_RETAIN", "javascript"), ("C:/NEVER_RETAIN", "unclassified"), ("node::Worker Error: ASSERTION FAILED C:/NEVER_RETAIN", "assertion") })
        {
            var summary = RestrictedChildStderr.Parse(Encoding.UTF8.GetBytes(text));
            Require(summary == new RestrictedChildStderr.Summary(category, null, null));
            Require(!JsonSerializer.Serialize(summary).Contains("NEVER_RETAIN", StringComparison.Ordinal));
        }
        foreach (string name in new[] { "uv_thread_create", "uv_os_get_passwd", "uv_loop_init", "uv_tty_init", "uv_pipe_init", "uv_pipe_open", "uv_guess_handle", "uv_disable_stdio_inheritance", "uv_signal_init", "uv_mutex_init" })
            Require(RestrictedChildStderr.Parse(Encoding.UTF8.GetBytes("C:/NEVER_RETAIN: " + name)).function == name);
        foreach (string name in new[] { "UV_UNKNOWN", "EACCES", "EPERM", "EBADF", "EINVAL", "ENOENT", "ENOMEM" })
            Require(RestrictedChildStderr.Parse(Encoding.UTF8.GetBytes("C:/NEVER_RETAIN: " + name)).code == name);
        Require(RestrictedChildStderr.Parse(Enumerable.Repeat((byte)0xff, 8192).ToArray()) == new RestrictedChildStderr.Summary("unclassified", null, null));
        bool refused = false; try { RestrictedChildStderr.Parse(new byte[8193]); } catch (InvalidOperationException) { refused = true; }
        Require(refused);
        const string header = "  #  C:/NEVER_RETAIN/node.exe: NEVER_RETAIN_SIGNATURE at C:\\NEVER_RETAIN\\src\\node.cc:1128\r\n  #  Assertion failed: ncrypto::CSPRNG(nullptr, 0)\n";
        var source = RestrictedChildStderr.Parse(Encoding.UTF8.GetBytes(header));
        Require(source.sourceFile == "node.cc" && source.sourceLine == 1128);
        Require(!JsonSerializer.Serialize(source).Contains("NEVER_RETAIN", StringComparison.Ordinal));
        Require(source.function == "ncrypto::CSPRNG");
        foreach (string invalid in new[] { header.Replace("node.cc", "NEVER_RETAIN.cc"), header.Replace(":1128", ":0"), header.Replace(":1128", ":100000"), header.Replace(" at ", " around "), header.Replace("Assertion failed", "unclassified error") })
        {
            var refusedSource = RestrictedChildStderr.Parse(Encoding.UTF8.GetBytes(invalid));
            Require(refusedSource.sourceFile is null && refusedSource.sourceLine is null);
        }
        Require(RestrictedChildStderr.Parse(Encoding.UTF8.GetBytes(header.Replace(":1128", ":99999"))).sourceLine == 99999);
        foreach (string valid in new[] { "lease-entered\n", "lease-entered\r\nPRIVATE_NOT_RETURNED" }) Require(RestrictedChildStderr.LeaseEntry(Encoding.UTF8.GetBytes(valid)));
        foreach (string invalid in new[] { "", "lease-entered", "prefix lease-entered\n", "\nlease-entered\n", "lease-enteredX\n", "lease-entered\r\r\n", "\u00fflease-entered\n" }) Require(!RestrictedChildStderr.LeaseEntry(Encoding.UTF8.GetBytes(invalid)));
        bool entryBound = false; try { RestrictedChildStderr.LeaseEntry(new byte[8193]); } catch (InvalidOperationException) { entryBound = true; } Require(entryBound);
        if (checks != 50) throw new InvalidOperationException("The complete child stderr parser inventory did not execute.");
        return checks;
    }
}
