using System.Text;

// These commands exchange UTF-8 over inherited streams. They never need to
// change a console code page or attach/allocate a console.
internal static class PipeTextProtocol
{
    internal static void Configure() => Configure(Console.OpenStandardInput(), Console.OpenStandardOutput(), Console.OpenStandardError());

    internal static void Configure(Stream input, Stream output, Stream error)
    {
        var encoding = new UTF8Encoding(false, true);
        Console.SetIn(new StreamReader(input, encoding, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true));
        Console.SetOut(new StreamWriter(output, encoding, bufferSize: 4096, leaveOpen: true) { AutoFlush = true, NewLine = "\n" });
        Console.SetError(new StreamWriter(error, encoding, bufferSize: 4096, leaveOpen: true) { AutoFlush = true, NewLine = "\n" });
    }
}
