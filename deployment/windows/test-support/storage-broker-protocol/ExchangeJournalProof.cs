using System.Text.Json.Nodes;

internal static class ExchangeJournalProof
{
    internal static int Run()
    {
        int checks = 0;
        void Require(bool value) { if (!value) throw new InvalidOperationException("The exact exchange reservation proof failed."); checks++; }
        void Refuses(Action action)
        {
            try { action(); } catch (Exception error) when (error is InvalidOperationException or System.Text.Json.JsonException or IOException) { checks++; return; }
            throw new InvalidOperationException("An uncertain exchange effect was admitted or an invalid journal was accepted.");
        }
        var binding = new WindowsStorageBrokerProtocol.Binding(Guid.NewGuid().ToString("D"), new string('a', 64), new string('b', 64));
        string operation = Guid.NewGuid().ToString("D"), task = new string('c', 64), inputs = new string('d', 64);
        var created = new WindowsStorageBrokerExchangeProtocol.Proof("created", true, false, false, true, false);
        var mounted = new WindowsStorageBrokerExchangeProtocol.Proof("mounted", true, true, true, false, true);
        var detached = new WindowsStorageBrokerExchangeProtocol.Proof("detached", true, false, false, true, false);
        var retired = new WindowsStorageBrokerExchangeProtocol.Proof("retired", true, false, false, true, false);
        WindowsStorageBrokerExchangeProtocol.RequestScope Request(string action = "create", string? id = null, string? nonce = null, string? taskScope = null) => WindowsStorageBrokerExchangeProtocol.ReadRequest(WindowsStorageBrokerExchangeProtocol.Request(binding, action, id ?? Guid.NewGuid().ToString("D"), operation, taskScope ?? task, inputs, nonce ?? new string('e', 64)), binding);
        var original = Request(); var rows = new List<byte[]>(); string fault = "";
        WindowsStorageBrokerExchangeJournal Journal(WindowsStorageBrokerProtocol.Binding? scope = null) => new(scope ?? binding, _ => rows.Select(bytes => (byte[])bytes.Clone()).ToArray(), (_, sequence, bytes) =>
        {
            if (fault == "before") throw new IOException("Synthetic reservation failure");
            if (sequence != rows.Count) throw new IOException("Exclusive append collision");
            rows.Add((byte[])bytes.Clone()); if (fault == "after") throw new IOException("Synthetic lost acknowledgement");
            if (fault == "changed") rows[^1] = "{}"u8.ToArray();
        });
        var journal = Journal(); Require(journal.Begin(original).EffectAllowed && rows.Count == 1);
        var pending = journal.Begin(Request(id: original.RequestId, nonce: new string('f', 64)));
        Require(!pending.EffectAllowed && pending.Replayed && pending.Result?.State == "outcome-unconfirmed");
        Refuses(() => journal.Begin(Request("attach")));
        Refuses(() => journal.Begin(Request(taskScope: new string('1', 64))));
        Refuses(() => journal.Complete(Request(id: original.RequestId, taskScope: new string('2', 64)), created));
        journal.Complete(original, created); Require(rows.Count == 2);
        var replay = journal.Begin(Request(id: original.RequestId, nonce: new string('f', 64)));
        Require(!replay.EffectAllowed && replay.Replayed && replay.Result == created && rows.Count == 2);
        journal.Complete(original, created); Require(rows.Count == 2);
        Refuses(() => journal.Complete(original, created with { State = "outcome-unconfirmed", DetachedVerified = false }));
        var attach = Request("attach"); Require(journal.Begin(attach).EffectAllowed); journal.Complete(attach, mounted);
        var observed = journal.Begin(Request("inspect")); Require(!observed.EffectAllowed && !observed.Replayed && observed.Result == mounted with { EffectStarted = false } && rows.Count == 4);
        Refuses(() => journal.Begin(Request("retire")));
        var detach = Request("detach"); Require(journal.Begin(detach).EffectAllowed); journal.Complete(detach, detached);
        Refuses(() => journal.Begin(Request("attach")));
        var retire = Request("retire"); Require(journal.Begin(retire).EffectAllowed); journal.Complete(retire, retired);
        Require(rows.Count == WindowsStorageBrokerExchangeJournal.MaximumEvents);
        Refuses(() => journal.Begin(Request("create")));
        byte[][] completed = rows.Select(row => (byte[])row.Clone()).ToArray(); rows.RemoveAt(0); Refuses(() => journal.Begin(Request("inspect")));
        rows.Clear(); rows.AddRange(completed); Refuses(() => Journal(binding with { ServiceImageSha256 = new string('3', 64) }).Begin(original));
        var parsed = JsonNode.Parse(rows[0])!.AsObject(); parsed["phase"] = "recorded"; rows[0] = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(parsed); Refuses(() => journal.Begin(Request("inspect")));
        rows.Clear(); fault = "before"; Refuses(() => journal.Begin(original)); Require(rows.Count == 0);
        fault = "after"; Refuses(() => journal.Begin(original)); Require(rows.Count == 1); fault = "";
        Require(!Journal().Begin(original).EffectAllowed); Refuses(() => Journal().Begin(Request("create")));
        fault = "after"; Refuses(() => journal.Complete(original, created)); Require(rows.Count == 2); fault = "";
        Require(Journal().Begin(original).Result == created && !Journal().Begin(original).EffectAllowed);
        rows.RemoveAt(1); Require(Journal().Begin(original).Result?.State == "outcome-unconfirmed");
        fault = "changed"; rows.Clear(); Refuses(() => journal.Begin(original)); fault = "";
        rows.Clear(); Require(journal.Begin(Request("inspect")).Result == null && rows.Count == 0);
        Refuses(() => journal.Begin(Request("attach"))); Require(rows.Count == 0);
        var fast = Request(); Require(journal.Begin(fast).EffectAllowed); journal.Complete(fast, created);
        var remove = Request("retire"); Require(journal.Begin(remove).EffectAllowed); journal.Complete(remove, retired); Require(rows.Count == 4);
        return checks;
    }
}
