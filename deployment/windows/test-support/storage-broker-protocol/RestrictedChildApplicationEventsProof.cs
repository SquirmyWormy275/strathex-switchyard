using System.Text.Json;
internal static class RestrictedChildApplicationEventsProof
{
    internal static int Run()
    {
        const string xml = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Application Error'/><EventID>1000</EventID></System><EventData><Data Name='ProcessId'>0x4d2</Data><Data Name='ProcessCreationTime'>0x123456789abcdef</Data><Data Name='ExceptionCode'>C0000142</Data><Data Name='ModuleName'>C:\\NEVER_RETAIN_ACCOUNT\\user32.dll</Data><Data Name='AppPath'>NEVER_RETAIN_PATH</Data></EventData></Event>";
        const ulong birth = 0x123456789abcdef; int checks = 0;
        void Require(bool value) { if (!value) throw new InvalidOperationException("The restricted child application-event privacy proof failed."); checks++; }
        var entry = RestrictedChildApplicationEvents.Parse(xml, 1234, birth);
        Require(entry is { eventId: 1000, exceptionCode: "c0000142", module: "user32.dll" });
        Require(!JsonSerializer.Serialize(entry).Contains("NEVER_RETAIN", StringComparison.Ordinal));
        Require(RestrictedChildApplicationEvents.Parse(xml, 1235, birth) is null);
        Require(RestrictedChildApplicationEvents.Parse(xml, 1234, birth + 1) is null);
        Require(RestrictedChildApplicationEvents.Parse(xml.Replace("Application Error", "Untrusted Provider"), 1234, birth) is null);
        Require(RestrictedChildApplicationEvents.Parse(xml.Replace(">1000<", ">1001<"), 1234, birth) is null);
        Require(RestrictedChildApplicationEvents.Parse(xml.Replace("Name='ProcessCreationTime'", "Name='UnverifiedCreationTime'"), 1234, birth) is null);
        Require(RestrictedChildApplicationEvents.Parse(xml.Replace("</EventData>", "<Data Name='ProcessId'>0x4d2</Data></EventData>"), 1234, birth) is null);
        Require(RestrictedChildApplicationEvents.Parse(xml.Replace("user32.dll", "NEVER_RETAIN_MODULE.dll"), 1234, birth)?.module == "unrecognized");
        Require(RestrictedChildApplicationEvents.Parse(xml.Replace("C0000142", "NEVER_RETAIN_CODE"), 1234, birth)?.exceptionCode is null);
        Require(RestrictedChildApplicationEvents.Parse(new string('x', 32769), 1234, birth) is null);
        Require(RestrictedChildApplicationEvents.Parse("<!DOCTYPE Event [<!ENTITY x SYSTEM 'file:///NEVER_RETAIN'>]><Event>&x;</Event>", 1234, birth) is null);
        if (checks != 12) throw new InvalidOperationException("The complete application-event parser inventory did not execute.");
        return checks;
    }
}
