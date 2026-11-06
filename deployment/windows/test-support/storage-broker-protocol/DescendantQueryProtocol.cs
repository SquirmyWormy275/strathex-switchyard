using System.Text.Json;
using System.Text.RegularExpressions;

// Test assembly only. No production token broker or generic process selector.
internal sealed record DescendantQueryRequest(int Sequence, string Role, uint Pid, string? Birth, string ExecutableSha256);
internal static class DescendantQueryProtocol
{
    internal const string Schema = "switchyard-descendant-query/v1";
    internal static DescendantQueryRequest Read(byte[] bytes, string nonce, int sequence)
    {
        void Require(bool value) { if (!value) throw new InvalidDataException("The exact descendant request changed."); }
        Require(bytes.Length is > 1 and <= 2048 && sequence is >= 1 and <= 64 && Regex.IsMatch(nonce, "^[a-f0-9]{32}$"));
        using var document = JsonDocument.Parse(bytes); var value = document.RootElement;
        Require(value.ValueKind == JsonValueKind.Object && value.EnumerateObject().Select(p => p.Name).Order().SequenceEqual(new[] { "birth", "executableSha256", "nonce", "pid", "role", "schema", "sequence" }));
        Require(value.GetProperty("schema").GetString() == Schema && value.GetProperty("nonce").GetString() == nonce && value.GetProperty("sequence").GetInt32() == sequence);
        string role = value.GetProperty("role").GetString() ?? "", digest = value.GetProperty("executableSha256").GetString() ?? "";
        uint pid = value.GetProperty("pid").GetUInt32(); string? birth = value.GetProperty("birth").GetString();
        Require(role is "guardian" or "worker" or "status" && pid > 0 && Regex.IsMatch(digest, "^[a-f0-9]{64}$")
            && (role == "worker" ? birth != null && Regex.IsMatch(birth, "^[1-9][0-9]{0,18}$") : birth == null));
        return new(sequence, role, pid, birth, digest);
    }
}
