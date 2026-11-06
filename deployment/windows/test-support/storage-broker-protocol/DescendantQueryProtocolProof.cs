using System.Text;
using System.Text.Json;

internal static class DescendantQueryProtocolProof
{
    internal static int Run()
    {
        const string nonce = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; int checks = 0;
        Dictionary<string, object?> Good() => new() { ["schema"] = DescendantQueryProtocol.Schema, ["nonce"] = nonce, ["sequence"] = 1, ["role"] = "guardian", ["pid"] = 123, ["birth"] = null, ["executableSha256"] = new string('b', 64) };
        void Reject(byte[] bytes, string expectedNonce = nonce, int sequence = 1)
        {
            try { DescendantQueryProtocol.Read(bytes, expectedNonce, sequence); }
            catch (Exception error) when (error is InvalidDataException or JsonException or InvalidOperationException or FormatException or OverflowException) { checks++; return; }
            throw new InvalidOperationException("A changed descendant request was accepted.");
        }
        foreach (string role in new[] { "guardian", "worker", "status" })
        {
            var value = Good(); value["role"] = role; value["birth"] = role == "worker" ? "638000000000000000" : null;
            var read = DescendantQueryProtocol.Read(JsonSerializer.SerializeToUtf8Bytes(value), nonce, 1);
            if (read.Role != role || read.Pid != 123 || read.Sequence != 1 || read.ExecutableSha256 != new string('b', 64)) throw new InvalidOperationException("The descendant identity changed."); checks++;
        }
        foreach (var change in new (string Key, object? Value)[] { ("schema", "other"), ("nonce", new string('c', 32)), ("sequence", 0), ("sequence", 65), ("role", "arbitrary"), ("pid", 0), ("pid", -1), ("pid", 4294967296L), ("birth", "1"), ("role", "worker"), ("executableSha256", new string('B', 64)), ("extra", true) })
        { var value = Good(); value[change.Key] = change.Value; Reject(JsonSerializer.SerializeToUtf8Bytes(value)); }
        foreach (string key in Good().Keys) { var value = Good(); value.Remove(key); Reject(JsonSerializer.SerializeToUtf8Bytes(value)); }
        foreach (string invalidBirth in new[] { "0", "01", "-1", new string('1', 20) }) { var value = Good(); value["role"] = "worker"; value["birth"] = invalidBirth; Reject(JsonSerializer.SerializeToUtf8Bytes(value)); }
        string text = JsonSerializer.Serialize(Good()); Reject(Encoding.UTF8.GetBytes(text[..^1] + ",\"pid\":123}")); Reject(new byte[2049]);
        Reject(JsonSerializer.SerializeToUtf8Bytes(Good()), sequence: 65); Reject(JsonSerializer.SerializeToUtf8Bytes(Good()), expectedNonce: "invalid");
        for (int sequence = 65; sequence <= 68; sequence++)
        {
            var value = Good(); value["sequence"] = sequence; value["role"] = "status";
            var read = DescendantQueryProtocol.Read(JsonSerializer.SerializeToUtf8Bytes(value), nonce, sequence);
            if (read.Sequence != sequence || read.Role != "status") throw new InvalidOperationException("Final status registration changed."); checks++;
            foreach (string role in new[] { "guardian", "worker" })
            {
                value["role"] = role; value["birth"] = role == "worker" ? "638000000000000000" : null;
                Reject(JsonSerializer.SerializeToUtf8Bytes(value), sequence: sequence);
            }
        }
        var excess = Good(); excess["sequence"] = 69; excess["role"] = "status";
        Reject(JsonSerializer.SerializeToUtf8Bytes(excess), sequence: 69);
        return checks;
    }
}
