/** Fixed SCM header invariants and bounded diagnostics, with no paths or account data. */
internal static class WindowsStorageBrokerServiceHeader
{
    internal static void Verify(uint type, uint start, uint error, Action<string>? phase = null)
    {
        phase?.Invoke("service-absence-configuration-header-type");
        if (type != 16) throw Invalid();
        phase?.Invoke(start switch
        {
            0 => "service-absence-configuration-header-start-boot",
            1 => "service-absence-configuration-header-start-system",
            2 => "service-absence-configuration-header-start-auto",
            3 => "service-absence-configuration-header-start-demand",
            4 => "service-absence-configuration-header-start-disabled",
            _ => "service-absence-configuration-header-start-unexpected"
        });
        if (start != 2) throw Invalid();
        phase?.Invoke(error switch
        {
            0 => "service-absence-configuration-header-error-ignore",
            1 => "service-absence-configuration-header-error-normal",
            2 => "service-absence-configuration-header-error-severe",
            3 => "service-absence-configuration-header-error-critical",
            _ => "service-absence-configuration-header-error-unexpected"
        });
        if (error != 1) throw Invalid();
    }
    private static Exception Invalid() => new InvalidOperationException("The exact protected broker service lifecycle did not verify.");
}
