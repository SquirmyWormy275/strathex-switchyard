using System.Buffers.Binary;

internal static class ColdRandomReport
{
    internal sealed record Evidence(uint systemStatus, uint providerOpenStatus, uint? providerStatus, uint? providerCloseStatus, bool handlesClosedVerified, bool buffersClearedVerified);
    internal static Evidence Parse(byte[] bytes)
    {
        if (bytes.Length != 32) throw new InvalidOperationException("The fixed cold random report length changed.");
        var words = Enumerable.Range(0, 8).Select(i => BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i * 4, 4))).ToArray();
        if (words[0] != 0x53584352 || words[1] != 1 || words[6] != 1 || words[7] != 1 || words[5] != 0 || words[3] != 0 && words[4] != 0)
            throw new InvalidOperationException("The fixed cold random report did not verify cleanup.");
        return new(words[2], words[3], words[3] == 0 ? words[4] : null, words[3] == 0 ? words[5] : null, true, true);
    }
    internal static int VerifyParser()
    {
        int checks = 0;
        byte[] Packet(params uint[] words) { var result = new byte[words.Length * 4]; for (int i = 0; i < words.Length; i++) BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(i * 4, 4), words[i]); return result; }
        void Check(bool value) { if (!value) throw new InvalidOperationException("Cold random parser proof failed."); checks++; }
        Check(Parse(Packet(0x53584352, 1, 0, 0, 0, 0, 1, 1)) == new Evidence(0, 0, 0, 0, true, true));
        Check(Parse(Packet(0x53584352, 1, 0xc0000022, 0xc0000022, 0, 0, 1, 1)) == new Evidence(0xc0000022, 0xc0000022, null, null, true, true));
        Check(Parse(Packet(0x53584352, 1, 0xffffffff, 0, 0xc0000022, 0, 1, 1)).providerStatus == 0xc0000022);
        foreach (var invalid in new[] { new byte[0], new byte[31], new byte[33], Packet(0, 1, 0, 0, 0, 0, 1, 1), Packet(0x53584352, 2, 0, 0, 0, 0, 1, 1), Packet(0x53584352, 1, 0, 0, 0, 0, 0, 1), Packet(0x53584352, 1, 0, 0, 0, 0, 1, 0), Packet(0x53584352, 1, 0, 0, 0, 1, 1, 1), Packet(0x53584352, 1, 0, 1, 1, 0, 1, 1) })
        {
            bool refused = false; try { Parse(invalid); } catch (InvalidOperationException) { refused = true; } Check(refused);
        }
        if (checks != 12) throw new InvalidOperationException("Incomplete cold random parser inventory.");
        return checks;
    }
}
