using System.Buffers.Binary;

internal static class ColdRandomReport
{
    internal sealed record LegacyEvidence(bool providerOpened, uint providerOpenError, bool? generated, uint? generateError, uint? providerCloseError, bool handlesClosedVerified, bool buffersClearedVerified);
    internal sealed record Evidence(uint systemStatus, uint providerOpenStatus, uint? providerStatus, uint? providerCloseStatus, bool handlesClosedVerified, bool buffersClearedVerified, string firstApi, LegacyEvidence legacy);
    internal static Evidence Parse(byte[] bytes)
    {
        if (bytes.Length != 64) throw new InvalidOperationException("The fixed cold random report length changed.");
        var w = Enumerable.Range(0, 16).Select(i => BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i * 4, 4))).ToArray();
        if (w[0] != 0x53584352 || w[1] != 2 || w[6] != 1 || w[7] != 1 || w[5] != 0 || w[3] != 0 && w[4] != 0
            || w[8] > 1 || w[10] > 1 || w[12] > 1 || w[14] != 1 || w[15] != 1
            || (w[8] == 0 ? w[10] != 0 || w[11] != 0 || w[12] != 0 || w[13] != 0 : w[9] != 0 || w[12] != 1 || w[13] != 0 || w[10] == 1 && w[11] != 0))
            throw new InvalidOperationException("The fixed cold random report did not verify statuses and cleanup.");
        return new(w[2], w[3], w[3] == 0 ? w[4] : null, w[3] == 0 ? w[5] : null, true, true, "legacy-cryptoapi",
            new(w[8] == 1, w[9], w[8] == 1 ? w[10] == 1 : null, w[8] == 1 ? w[11] : null, w[8] == 1 ? w[13] : null, true, true));
    }
    internal static int VerifyParser()
    {
        int checks = 0;
        byte[] Packet(params uint[] words) { var result = new byte[words.Length * 4]; for (int i = 0; i < words.Length; i++) BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(i * 4, 4), words[i]); return result; }
        uint[] good = { 0x53584352, 2, 0, 0, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1 };
        byte[] Changed(int index, uint value) { var words = (uint[])good.Clone(); words[index] = value; return Packet(words); }
        byte[] Unopened(int index = 9, uint value = 5) { var words = (uint[])good.Clone(); words[8] = words[10] = words[12] = 0; words[index] = value; return Packet(words); }
        void Check(bool value) { if (!value) throw new InvalidOperationException("Cold random parser proof failed."); checks++; }
        Check(Parse(Packet(good)) == new Evidence(0, 0, 0, 0, true, true, "legacy-cryptoapi", new(true, 0, true, 0, 0, true, true)));
        Check(Parse(Unopened()).legacy == new LegacyEvidence(false, 5, null, null, null, true, true));
        Check(Parse(Packet(0x53584352, 2, 0xc0000022, 0xc0000022, 0, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1)).providerStatus == null);
        Check(Parse(Packet(0x53584352, 2, 0, 0, 0xc0000022, 0, 1, 1, 1, 0, 0, 0x80090020, 1, 0, 1, 1)).legacy == new LegacyEvidence(true, 0, false, 0x80090020, 0, true, true));
        Check(Parse(Unopened(9, 0)).legacy.providerOpened == false);
        foreach (var invalid in new[] {
            new byte[0], new byte[63], new byte[65], Changed(0, 0), Changed(1, 1), Changed(1, 3), Changed(6, 0), Changed(7, 0), Changed(5, 1), Packet(0x53584352, 2, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1),
            Changed(8, 2), Changed(10, 2), Changed(12, 2), Changed(9, 1), Changed(11, 1), Changed(12, 0), Changed(13, 1), Changed(14, 0), Changed(15, 0), Unopened(10, 1), Unopened(11, 1), Unopened(12, 1), Unopened(13, 1) })
        {
            bool refused = false; try { Parse(invalid); } catch (InvalidOperationException) { refused = true; } Check(refused);
        }
        if (checks != 28) throw new InvalidOperationException("Incomplete cold random parser inventory.");
        return checks;
    }
}
