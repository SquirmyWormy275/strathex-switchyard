using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Xml;
using System.Xml.Linq;

// Test assembly only. Reads at most 32 existing local Application Error events.
// No subscription, registry/log configuration, process retry or exception bypass.
internal static class RestrictedChildApplicationEvents
{
    internal sealed record Entry(int eventId, string? exceptionCode, string module);
    private static readonly string[] Modules = { "node.exe", "ntdll.dll", "kernel32.dll", "kernelbase.dll", "user32.dll", "gdi32.dll", "gdi32full.dll", "ucrtbase.dll", "advapi32.dll", "crypt32.dll", "wintrust.dll", "ws2_32.dll", "bcrypt.dll", "sechost.dll" };
    private static bool Number(string? text, out ulong value)
    {
        value = 0; if (text is null || text.Length is < 1 or > 20) return false;
        bool hex = text.StartsWith("0x", StringComparison.OrdinalIgnoreCase);
        return ulong.TryParse(hex ? text[2..] : text, hex ? NumberStyles.AllowHexSpecifier : NumberStyles.None, CultureInfo.InvariantCulture, out value);
    }
    internal static Entry? Parse(string xml, uint pid, ulong creationTime)
    {
        if (pid == 0 || creationTime == 0 || xml.Length > 32768) return null;
        try
        {
            using var text = new StringReader(xml);
            using var reader = XmlReader.Create(text, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 32768 });
            var document = XDocument.Load(reader); XNamespace ns = "http://schemas.microsoft.com/win/2004/08/events/event";
            var root = document.Root; if (root?.Name != ns + "Event") return null;
            var system = root.Element(ns + "System");
            if (system?.Element(ns + "Provider")?.Attribute("Name")?.Value != "Application Error" || system.Element(ns + "EventID")?.Value != "1000") return null;
            var items = root.Element(ns + "EventData")?.Elements(ns + "Data").ToArray();
            if (items is null || items.Length > 32 || items.Any(item => item.Value.Length > 2048)) return null;
            var data = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var item in items) { string? name = item.Attribute("Name")?.Value; if (name is null || name.Length > 80 || !data.TryAdd(name, item.Value)) return null; }
            if (!Number(data.GetValueOrDefault("ProcessId"), out ulong process) || process != pid || !Number(data.GetValueOrDefault("ProcessCreationTime"), out ulong birth) || birth != creationTime) return null;
            string? code = data.GetValueOrDefault("ExceptionCode"); if (code?.StartsWith("0x", StringComparison.OrdinalIgnoreCase) == true) code = code[2..];
            code = code is { Length: 8 } && code.All(char.IsAsciiHexDigit) ? code.ToLowerInvariant() : null;
            string module = (data.GetValueOrDefault("ModuleName") ?? "").Replace('\\', '/').Split('/').Last().ToLowerInvariant();
            return new Entry(1000, code, Modules.Contains(module, StringComparer.Ordinal) ? module : "unrecognized");
        }
        catch (XmlException) { return null; }
    }

    [SupportedOSPlatform("windows")]
    internal static object Capture(uint pid, ulong creationTime)
    {
        var entries = new List<Entry>(); bool completed = false, closed = true; IntPtr query = IntPtr.Zero;
        try
        {
            const string filter = "*[System[Provider[@Name='Application Error'] and (EventID=1000) and TimeCreated[timediff(@SystemTime) <= 120000]]]";
            query = EvtQuery(IntPtr.Zero, "Application", filter, 0x201);
            if (query != IntPtr.Zero)
            {
                for (int i = 0; i < 32; i++)
                {
                    var handles = new IntPtr[1];
                    if (!EvtNext(query, 1, handles, 0, 0, out uint count)) { completed = Marshal.GetLastWin32Error() == 259; break; }
                    if (count != 1 || handles[0] == IntPtr.Zero) { foreach (var handle in handles) if (handle != IntPtr.Zero) closed &= EvtClose(handle); break; }
                    try
                    {
                        var entry = Parse(Render(handles[0]), pid, creationTime); if (entry is not null && entries.Count < 4) entries.Add(entry);
                    }
                    finally { closed &= EvtClose(handles[0]); }
                    if (i == 31) completed = true;
                }
            }
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or XmlException or DllNotFoundException or EntryPointNotFoundException) { completed = false; }
        finally { if (query != IntPtr.Zero) closed &= EvtClose(query); }
        return new { schema = "switchyard-restricted-child-application-events/v1", queryStatus = completed && closed ? "completed" : "unavailable", handlesClosedVerified = closed, entries = completed && closed ? entries.ToArray() : Array.Empty<Entry>() };
    }
    [SupportedOSPlatform("windows")]
    private static string Render(IntPtr handle)
    {
        bool first = EvtRender(IntPtr.Zero, handle, 1, 0, IntPtr.Zero, out uint required, out _); int error = Marshal.GetLastWin32Error();
        if (first || error != 122 || required < 2 || required > 65536 || (required & 1) != 0) throw new InvalidOperationException("The bounded event render was unavailable.");
        IntPtr buffer = Marshal.AllocHGlobal(checked((int)required));
        try
        {
            if (!EvtRender(IntPtr.Zero, handle, 1, required, buffer, out uint used, out _) || used < 2 || used > required || (used & 1) != 0 || Marshal.ReadInt16(buffer, checked((int)used - 2)) != 0) throw new InvalidOperationException("The bounded event read did not verify.");
            return Marshal.PtrToStringUni(buffer, checked((int)used / 2 - 1)) ?? "";
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("wevtapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr EvtQuery(IntPtr session, string path, string query, uint flags);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("wevtapi.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EvtNext(IntPtr query, uint size, [Out] IntPtr[] events, uint timeout, uint flags, out uint returned);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("wevtapi.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EvtRender(IntPtr context, IntPtr fragment, uint flags, uint size, IntPtr buffer, out uint used, out uint propertyCount);
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)] [DllImport("wevtapi.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EvtClose(IntPtr handle);
}
