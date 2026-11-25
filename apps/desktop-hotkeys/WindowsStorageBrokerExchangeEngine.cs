using System.Runtime.Versioning;
using System.Text.Json;

// No request supplies a path, capacity, disk number, executable or mount target.
// This engine is not a guest authority: the normal Run/consumer connection must
// additionally establish the original guest's independent exit before cleanup.
[SupportedOSPlatform("windows")]
internal static class WindowsStorageBrokerExchangeEngine
{
    private static Exception Invalid() => new InvalidOperationException("The original bounded exchange effect remains unavailable or unconfirmed; preserve it without replay.");
    private static WindowsStorageBrokerExchangeProtocol.Proof Unknown(bool effect) => new("outcome-unconfirmed", effect, false, false, false, false);
    private static JsonElement Image(WindowsStorageBrokerExchangeFiles files, string operationId)
    {
        return WindowsStorageBrokerExchangeFacts.Image(files.ReadFact(operationId, "image.json"), operationId);
    }
    private static JsonElement Volume(WindowsStorageBrokerInstallation.Settings settings, WindowsStorageBrokerExchangeFiles files, string operationId, JsonElement image, string action)
    {
        var request = new Dictionary<string, object?>
        {
            ["schema"] = "switchyard-windows-bounded-volume/v1", ["action"] = action, ["operationId"] = operationId,
            ["stagingRoot"] = files.DiskRoot(operationId), ["stagingIdentity"] = image.GetProperty("stagingIdentity"),
            ["imageIdentity"] = image.GetProperty("imageIdentity"), ["mountIdentity"] = image.GetProperty("mountIdentity"), ["footerSha256"] = image.GetProperty("footerSha256")
        };
        if (action == "attach") request["initialImageSha256"] = image.GetProperty("imageSha256");
        return ReviewedInputStager.BrokerBoundedVolume(settings, JsonSerializer.SerializeToElement(request));
    }
    private static void OriginalVolume(WindowsStorageBrokerExchangeFiles files, string operationId, JsonElement volume)
    {
        string original = WindowsStorageBrokerExchangeFacts.Mount(files.ReadFact(operationId, "mount.json"), operationId);
        if (original != volume.GetProperty("volume").GetString()) throw Invalid();
    }
    internal static WindowsStorageBrokerExchangeProtocol.Proof Execute(WindowsStorageBrokerInstallation.Settings settings, WindowsStorageBrokerExchangeProtocol.RequestScope request)
    {
        if (WindowsStorageBrokerFiles.CurrentOwnerSid() != "S-1-5-18") throw Invalid();
        WindowsStorageBrokerExchangeProtocol.CheckRequest(settings.Binding, request);
        using var installation = WindowsStorageBrokerFiles.PinDirectory(settings.Root, settings.ClientSid);
        var files = new WindowsStorageBrokerExchangeFiles(settings); var journal = files.Journal();
        // One retained active 64 MiB image per installation. Unknown/empty or
        // reserved operation folders count as active, never as spare capacity.
        if (request.Action == "create" && journal.Current(request.OperationId) == null)
            foreach (string id in files.Operations()) if (id != request.OperationId && journal.Current(id) is not { Phase: "recorded", Proof.State: "retired" }) throw Invalid();
        var admission = journal.Begin(request);
        if (admission.Replayed) return admission.Result ?? throw Invalid();
        if (request.Action == "inspect")
        {
            var recorded = admission.Result;
            if (recorded == null || recorded.State == "outcome-unconfirmed") return Unknown(false);
            try
            {
                if (recorded.State == "retired") { if (!files.DiskAbsent(request.OperationId)) throw Invalid(); return recorded; }
                var actual = Volume(settings, files, request.OperationId, Image(files, request.OperationId), "inspect");
                if (actual.GetProperty("attached").GetBoolean() != recorded.Attached || actual.GetProperty("mounted").GetBoolean() != recorded.Mounted || actual.GetProperty("detachedVerified").GetBoolean() != recorded.DetachedVerified || actual.GetProperty("exchangeQuotaEnforced").GetBoolean() != recorded.ExchangeQuotaEnforced) throw Invalid();
                if (recorded.Mounted) OriginalVolume(files, request.OperationId, actual); return recorded;
            }
            catch { return Unknown(false); }
        }
        if (!admission.EffectAllowed) throw Invalid();
        try
        {
            WindowsStorageBrokerExchangeProtocol.Proof result;
            if (request.Action == "create")
            {
                var image = ReviewedInputStager.CreateBrokerImage(settings, request.OperationId); files.WriteFact(request.OperationId, "image.json", JsonSerializer.SerializeToUtf8Bytes(image));
                ReviewedInputStager.VerifyBrokerImage(settings, Image(files, request.OperationId), true); result = new("created", true, false, false, true, false);
            }
            else
            {
                var image = Image(files, request.OperationId);
                if (request.Action == "attach")
                {
                    ReviewedInputStager.VerifyBrokerImage(settings, image, true);
                    var mounted = Volume(settings, files, request.OperationId, image, "attach");
                    if (!mounted.GetProperty("attached").GetBoolean() || !mounted.GetProperty("mounted").GetBoolean() || !mounted.GetProperty("exchangeQuotaEnforced").GetBoolean()) throw Invalid();
                    files.WriteFact(request.OperationId, "mount.json", JsonSerializer.SerializeToUtf8Bytes(new { schema = "switchyard-windows-broker-mount/v1", operationId = request.OperationId, volume = mounted.GetProperty("volume") }));
                    var observed = Volume(settings, files, request.OperationId, image, "inspect"); OriginalVolume(files, request.OperationId, observed); result = new("mounted", true, true, true, false, true);
                }
                else if (request.Action == "detach")
                {
                    var before = Volume(settings, files, request.OperationId, image, "inspect");
                    if (!before.GetProperty("attached").GetBoolean() || !before.GetProperty("mounted").GetBoolean()) throw Invalid(); OriginalVolume(files, request.OperationId, before);
                    var detached = Volume(settings, files, request.OperationId, image, "detach");
                    if (!detached.GetProperty("detachedVerified").GetBoolean()) throw Invalid(); OriginalVolume(files, request.OperationId, detached); result = new("detached", true, false, false, true, false);
                }
                else if (request.Action == "retire")
                {
                    var observed = Volume(settings, files, request.OperationId, image, "inspect"); if (!observed.GetProperty("detachedVerified").GetBoolean()) throw Invalid();
                    ReviewedInputStager.RetireBrokerImage(settings, image); result = new("retired", true, false, false, true, false);
                }
                else throw Invalid();
            }
            journal.Complete(request, result); return result;
        }
        catch
        {
            var result = Unknown(true); try { journal.Complete(request, result); } catch { }
            return result;
        }
    }
}
