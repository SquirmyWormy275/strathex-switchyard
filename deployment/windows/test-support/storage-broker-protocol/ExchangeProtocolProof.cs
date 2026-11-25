using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

internal static class ExchangeProtocolProof
{
    internal static int Run()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        using var foreign = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var binding = new WindowsStorageBrokerProtocol.Binding(Guid.NewGuid().ToString("D"), new string('a', 64), new string('b', 64));
        string operation = Guid.NewGuid().ToString("D"), requestId = Guid.NewGuid().ToString("D"), task = new string('c', 64), inputs = new string('d', 64), nonce = new string('e', 64);
        byte[] publicKey = key.ExportSubjectPublicKeyInfo(); int checks = 0;
        void Require(bool value) { if (!value) throw new InvalidOperationException("The bounded exchange protocol proof failed."); checks++; }
        void Refuses(Action action)
        {
            try { action(); } catch (Exception error) when (error is InvalidOperationException or System.Text.Json.JsonException or CryptographicException or FormatException or DecoderFallbackException) { checks++; return; }
            throw new InvalidOperationException("An untrusted bounded exchange request or result was accepted.");
        }
        WindowsStorageBrokerExchangeProtocol.RequestScope Request(string action = "create", string? freshNonce = null) => WindowsStorageBrokerExchangeProtocol.ReadRequest(WindowsStorageBrokerExchangeProtocol.Request(binding, action, requestId, operation, task, inputs, freshNonce ?? nonce), binding);
        foreach (var action in new[] { "create", "inspect", "attach", "detach", "retire" })
        {
            var request = Request(action); bool mounted = action == "attach";
            var proof = new WindowsStorageBrokerExchangeProtocol.Proof(action switch { "attach" => "mounted", "detach" => "detached", "retire" => "retired", _ => "created" }, action != "inspect", mounted, mounted, !mounted, mounted);
            byte[] reply = WindowsStorageBrokerExchangeProtocol.Reply(binding, request, proof, key);
            Require(WindowsStorageBrokerExchangeProtocol.Verify(reply, binding, request, publicKey) == proof);
        }
        var original = Request(); var next = Request(freshNonce: new string('f', 64));
        Require(original.EffectDigest == next.EffectDigest);
        Require(original.Digest != next.Digest);
        byte[] raw = WindowsStorageBrokerExchangeProtocol.Request(binding, "create", requestId, operation, task, inputs, nonce);
        var node = JsonNode.Parse(raw)!.AsObject(); node["path"] = "C:\\foreign";
        Refuses(() => WindowsStorageBrokerExchangeProtocol.ReadRequest(Encoding.UTF8.GetBytes(node.ToJsonString()), binding));
        node = JsonNode.Parse(raw)!.AsObject(); node["virtualBytes"] = long.MaxValue;
        Refuses(() => WindowsStorageBrokerExchangeProtocol.ReadRequest(Encoding.UTF8.GetBytes(node.ToJsonString()), binding));
        string text = Encoding.UTF8.GetString(raw);
        Refuses(() => WindowsStorageBrokerExchangeProtocol.ReadRequest(Encoding.UTF8.GetBytes(text.Replace("\"nonce\":", "\"nonce\":\"" + nonce + "\",\"nonce\":", StringComparison.Ordinal)), binding));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Request(binding, "format", requestId, operation, task, inputs, nonce));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Request(binding, "create", requestId, "../foreign", task, inputs, nonce));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Request(binding, "create", requestId, operation, "unreviewed", inputs, nonce));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.ReadRequest(new byte[16385], binding));
        var created = new WindowsStorageBrokerExchangeProtocol.Proof("created", true, false, false, true, false);
        byte[] signed = WindowsStorageBrokerExchangeProtocol.Reply(binding, original, created, key);
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(signed, binding, original, foreign.ExportSubjectPublicKeyInfo()));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(signed, binding, original, publicKey.Concat(new byte[] { 0 }).ToArray()));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(signed, binding, next, publicKey));
        foreach (var changed in new[] { original with { OperationId = Guid.NewGuid().ToString("D") }, original with { TaskScopeSha256 = new string('1', 64) }, original with { InputManifestSha256 = new string('2', 64) }, original with { Digest = new string('3', 64) }, original with { EffectDigest = new string('4', 64) } }) Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(signed, binding, changed, publicKey));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(signed, binding with { InstallationId = Guid.NewGuid().ToString("D") }, original, publicKey));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(signed, binding with { ServiceImageSha256 = new string('5', 64) }, original, publicKey));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Reply(binding, original, created with { Mounted = true }, key));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Reply(binding, Request("attach"), new("mounted", true, true, true, false, false), key));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Reply(binding, Request("inspect"), created, key));
        Refuses(() => WindowsStorageBrokerExchangeProtocol.Reply(binding, Request("retire"), created, key));
        foreach (var field in new[] { "virtualBytes", "sandboxEnforced" })
        {
            var envelope = JsonNode.Parse(signed)!.AsObject(); var payload = JsonNode.Parse(envelope["payload"]!.GetValue<string>())!.AsObject();
            if (field == "virtualBytes") payload["proof"]![field] = long.MaxValue; else payload["proof"]![field] = true;
            byte[] bytes = Encoding.UTF8.GetBytes(payload.ToJsonString()); envelope["payload"] = Encoding.UTF8.GetString(bytes);
            envelope["signature"] = Convert.ToBase64String(key.SignData(bytes, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
            Refuses(() => WindowsStorageBrokerExchangeProtocol.Verify(Encoding.UTF8.GetBytes(envelope.ToJsonString()), binding, original, publicKey));
        }
        return checks;
    }
}
