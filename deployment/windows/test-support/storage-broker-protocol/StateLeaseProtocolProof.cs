using System.Text;

internal static class StateLeaseProtocolProof
{
    internal static int Run()
    {
        int checks = 0;
        void Require(bool value) { if (!value) throw new InvalidOperationException("Lease parser proof failed."); checks++; }
        void Refuses(Action action)
        {
            try { action(); }
            catch (Exception error) when (error is InvalidOperationException or FormatException or DecoderFallbackException) { checks++; return; }
            throw new InvalidOperationException("An invalid lease command was accepted.");
        }
        string Request(string path, string owner = "pipe", string trace = "0", string extra = "0") =>
            $"SXSY-LOCK/2\t{owner}\t{trace}\t{extra}\t{Convert.ToBase64String(Encoding.UTF8.GetBytes(path))}";
        const string literal = "C:\\Private space\\私用\\literal $() `';.lock";
        var valid = StateLeaseWorker.ParseRequest(Request(literal, trace: "1"));
        Require(valid.Path == literal && valid.Trace);
        foreach (string path in new[] { "", "relative", "C:relative", "\\root-relative", "\\\\server\\share", "\\\\.\\pipe\\other", "C:\\x\n", "C:\\x\0", "C:\\x:stream", "C:\\" + new string('界', 5462) }) Refuses(() => StateLeaseWorker.ParseRequest(Request(path)));
        foreach (string owner in new[] { "42", "PIPE", " pipe", "pipe ", "process", "", "pipe\tother" }) Refuses(() => StateLeaseWorker.ParseRequest(Request(literal, owner)));
        Refuses(() => StateLeaseWorker.ParseRequest(Request(literal).Replace("SXSY-LOCK/2\tpipe", "SXSY-LOCK/1\t42")));
        Refuses(() => StateLeaseWorker.ParseRequest(Request(literal, trace: "2")));
        Refuses(() => StateLeaseWorker.ParseRequest(Request(literal, extra: "1")));
        Refuses(() => StateLeaseWorker.ParseRequest(Request(literal) + "\textra"));
        Refuses(() => StateLeaseWorker.ParseRequest("SXSY-LOCK/2\tpipe\t0\t0\t/w=="));
        Refuses(() => StateLeaseWorker.ParseRequest(Request(literal) + " "));
        Require(StateLeaseWorker.ParseAcquire("ACQUIRE 1 0", 0) == (1, false));
        Require(StateLeaseWorker.ParseAcquire("ACQUIRE 2 1", 1) == (2, true));
        foreach (string command in new[] { "ACQUIRE 1 0", "ACQUIRE 3 0", "ACQUIRE 02 0", "ACQUIRE 2 2", "acquire 2 0", "ACQUIRE 2 0 extra", "ACQUIRE\t2 0" }) Refuses(() => StateLeaseWorker.ParseAcquire(command, 1));
        Refuses(() => StateLeaseWorker.ParseAcquire("ACQUIRE 1 0", int.MaxValue));
        Require(StateLeaseWorker.ReadLine(new StringReader("READY\n"), 5) == "READY");
        Require(StateLeaseWorker.ReadLine(new StringReader(""), 5) == null);
        foreach (string line in new[] { "READY", "READY\r\n", "READY!\n", "\u0080\n", "A\tB\n" }) Refuses(() => StateLeaseWorker.ReadLine(new StringReader(line), 5));
        var bytes = new Queue<int>(); int reads = 0, arrivals = 0, queries = 0;
        using var fragmented = new StateLeaseWorker.LeasePipeReader(() => {
            reads++;
            if (bytes.Count == 0 && arrivals < 2) foreach (char c in ++arrivals == 1 ? "REA" : "DY\n") bytes.Enqueue(c);
            return bytes.Count > 0 ? bytes.Dequeue() : -1;
        }, () => { queries++; return arrivals < 2 ? 0u : null; });
        fragmented.AssertConnected(); Require(queries == 1);
        Require(StateLeaseWorker.ReadLine(fragmented, 5) == "READY"); Require(arrivals == 2 && reads == 6);
        Require(queries == 1); // Reads wait for input itself, never a polling timer.
        Require(fragmented.Read() == -1);
        Refuses(fragmented.AssertConnected);
        using var quiet = new StateLeaseWorker.LeasePipeReader(() => -1, () => 0u);
        quiet.AssertConnected(); Require(quiet.Read() == -1);
        bytes.Enqueue('R');
        using var partial = new StateLeaseWorker.LeasePipeReader(() => bytes.Count > 0 ? bytes.Dequeue() : -1, () => null);
        Refuses(() => StateLeaseWorker.ReadLine(partial, 5));
        foreach (int badByte in new[] { -2, 256 })
        {
            using var corrupt = new StateLeaseWorker.LeasePipeReader(() => badByte, () => 1u);
            Refuses(() => corrupt.Read());
        }
        using var failed = new StateLeaseWorker.LeasePipeReader(() => throw new InvalidOperationException("Synthetic pipe read failure."), () => throw new InvalidOperationException("Synthetic pipe query failure."));
        Refuses(failed.AssertConnected); Refuses(() => failed.Read());
        return checks;
    }
}
