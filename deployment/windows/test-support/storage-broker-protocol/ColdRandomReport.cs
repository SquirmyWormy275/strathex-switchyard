using System.Buffers.Binary;

internal static class ColdRandomReport
{
    internal sealed record LegacyEvidence(bool providerOpened, uint providerOpenError, bool? generated, uint? generateError, uint? providerCloseError, bool handlesClosedVerified, bool buffersClearedVerified);
    internal sealed record LookupEvidence(bool succeeded, uint error, string? providerClass, bool bufferClearedVerified);
    internal sealed record LookupPair(LookupEvidence user, LookupEvidence machine);
    internal sealed record Evidence(uint systemStatus, uint providerOpenStatus, uint? providerStatus, uint? providerCloseStatus, bool handlesClosedVerified, bool buffersClearedVerified, string firstApi, LegacyEvidence legacy, LegacyEvidence enhancedProvider, LookupPair providerLookups);
    private static LegacyEvidence Legacy(uint[] w, int i)
    {
        if (w[i] > 1 || w[i+2] > 1 || w[i+4] > 1 || w[i+6] != 1 || w[i+7] != 1
            || (w[i] == 0 ? w[i+2] != 0 || w[i+3] != 0 || w[i+4] != 0 || w[i+5] != 0 : w[i+1] != 0 || w[i+4] != 1 || w[i+5] != 0 || w[i+2] == 1 && w[i+3] != 0))
            throw new InvalidOperationException("The fixed legacy report did not verify statuses and cleanup.");
        return new(w[i] == 1, w[i+1], w[i] == 1 ? w[i+2] == 1 : null, w[i] == 1 ? w[i+3] : null, w[i] == 1 ? w[i+5] : null, true, true);
    }
    private static LookupEvidence Lookup(uint[] w, int i)
    {
        if (w[i] > 1 || w[i+2] > 3 || w[i+3] != 1 || (w[i] == 1 ? w[i+1] != 0 : w[i+2] != 0)) throw new InvalidOperationException("The fixed provider lookup did not verify.");
        return new(w[i] == 1, w[i+1], w[i] == 1 ? new[] { "other", "enhanced", "strong", "base" }[w[i+2]] : null, true);
    }
    internal static Evidence Parse(byte[] bytes)
    {
        if (bytes.Length != 128) throw new InvalidOperationException("The fixed cold random report length changed.");
        var w = Enumerable.Range(0, 32).Select(i => BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i * 4, 4))).ToArray();
        if (w[0] != 0x53584352 || w[1] != 3 || w[6] != 1 || w[7] != 1 || w[5] != 0 || w[3] != 0 && w[4] != 0) throw new InvalidOperationException("The fixed CNG report did not verify cleanup.");
        return new(w[2], w[3], w[3] == 0 ? w[4] : null, w[3] == 0 ? w[5] : null, true, true, "legacy-cryptoapi", Legacy(w, 8), Legacy(w, 16), new(Lookup(w, 24), Lookup(w, 28)));
    }
    internal static int VerifyParser()
    {
        int checks = 0;
        byte[] Packet(uint[] words) { var result = new byte[words.Length * 4]; for (int i = 0; i < words.Length; i++) BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(i * 4, 4), words[i]); return result; }
        uint[] good = { 0x53584352, 3, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1 };
        byte[] Changed(params (int i, uint v)[] changes) { var w = (uint[])good.Clone(); foreach (var (i,v) in changes) w[i] = v; return Packet(w); }
        byte[] Unopened(int i, int relative = 1, uint value = 5) => Changed((i,0),(i+2,0),(i+4,0),(i+relative,value));
        void Check(bool value) { if (!value) throw new InvalidOperationException("Cold random parser proof failed."); checks++; }
        void Refuse(byte[] bytes) { bool refused = false; try { Parse(bytes); } catch (InvalidOperationException) { refused = true; } Check(refused); }
        Check(Parse(Packet(good)).providerLookups == new LookupPair(new(true,0,"enhanced",true),new(true,0,"enhanced",true)));
        Check(Parse(Changed((2,0xc0000022),(3,0xc0000022))).providerStatus == null);
        foreach (int i in new[] { 8,16 })
        {
            LegacyEvidence Select(Evidence e) => i == 8 ? e.legacy : e.enhancedProvider;
            Check(Select(Parse(Unopened(i))) == new LegacyEvidence(false,5,null,null,null,true,true));
            Check(Select(Parse(Changed((i+2,0),(i+3,0x80090020)))) == new LegacyEvidence(true,0,false,0x80090020,0,true,true));
            Check(Select(Parse(Unopened(i,1,0))).providerOpened == false);
            foreach (var invalid in new[] { Changed((i,2)),Changed((i+2,2)),Changed((i+4,2)),Changed((i+1,1)),Changed((i+3,1)),Changed((i+4,0)),Changed((i+5,1)),Changed((i+6,0)),Changed((i+7,0)),Unopened(i,2,1),Unopened(i,3,1),Unopened(i,4,1),Unopened(i,5,1) }) Refuse(invalid);
        }
        foreach (var invalid in new[] { new byte[0],new byte[127],new byte[129],Changed((0,0)),Changed((1,2)),Changed((1,4)),Changed((6,0)),Changed((7,0)),Changed((5,1)),Changed((3,1),(4,1)) }) Refuse(invalid);
        foreach (int i in new[] { 24,28 })
        {
            var e = Parse(Changed((i,0),(i+1,5),(i+2,0))); Check((i == 24 ? e.providerLookups.user : e.providerLookups.machine) == new LookupEvidence(false,5,null,true));
            foreach (var invalid in new[] { Changed((i,2)),Changed((i+1,1)),Changed((i+2,4)),Changed((i+3,0)),Changed((i,0),(i+2,1)) }) Refuse(invalid);
        }
        if (checks != 56) throw new InvalidOperationException("Incomplete cold random parser inventory.");
        return checks;
    }
}
