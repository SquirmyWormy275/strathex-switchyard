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
        if (checks != 31) throw new InvalidOperationException("The complete child stderr parser inventory did not execute.");
        return checks;
    }
}
