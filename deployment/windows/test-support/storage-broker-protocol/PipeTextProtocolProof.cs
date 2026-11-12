using System.Text;

internal static class PipeTextProtocolProof
{
    internal static int Run()
    {
        var previousInput = Console.In; var previousOutput = Console.Out; var previousError = Console.Error;
        int checks = 0;
        void Require(bool condition) { if (!condition) throw new InvalidOperationException("The UTF-8 pipe contract did not verify."); checks++; }
        try
        {
            const string sample = "café 日本語 🦊";
            using var input = new MemoryStream(Encoding.UTF8.GetBytes(sample + "\n"));
            using var output = new MemoryStream(); using var error = new MemoryStream();
            PipeTextProtocol.Configure(input, output, error);
            Require(Console.ReadLine() == sample);
            Require(Console.ReadLine() is null);
            Console.WriteLine(sample); Console.Error.WriteLine(sample);
            byte[] expected = Encoding.UTF8.GetBytes(sample + "\n");
            Require(output.ToArray().SequenceEqual(expected));
            Require(error.ToArray().SequenceEqual(expected));
            Console.In.Dispose(); Console.Out.Dispose(); Console.Error.Dispose();
            Require(input.CanRead && output.CanWrite && error.CanWrite);

            foreach (byte[] invalid in new[] { new byte[] { 0xc0, 0xaf }, new byte[] { 0xf0, 0x9f }, new byte[] { 0xed, 0xa0, 0x80 } })
            {
                using var malformed = new MemoryStream(invalid);
                PipeTextProtocol.Configure(malformed, output, error);
                bool refused = false;
                try { Console.In.ReadToEnd(); } catch (DecoderFallbackException) { refused = true; }
                Require(refused);
            }
            using var bom = new MemoryStream(new byte[] { 0xef, 0xbb, 0xbf, 0x61 });
            PipeTextProtocol.Configure(bom, output, error);
            Require(Console.In.ReadToEnd() == "\ufeffa");
            bool outputRefused = false;
            try { Console.Write("\ud800"); Console.Out.Flush(); } catch (EncoderFallbackException) { outputRefused = true; }
            Require(outputRefused);
            return checks;
        }
        finally { Console.SetIn(previousInput); Console.SetOut(previousOutput); Console.SetError(previousError); }
    }
}
