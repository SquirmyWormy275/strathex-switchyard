// Pure numeric guard proof. No SCM, registry, account, process or USER API is invoked.
internal static class ServiceHeaderProof
{
    internal static int Run()
    {
        int checks = 0;
        WindowsStorageBrokerServiceHeader.Verify(16, 2, 1); checks++;
        foreach (int field in new[] { 0, 1, 2 })
        {
            foreach (uint alternative in Enumerable.Range(0, 256).Select(value => (uint)value).Append(uint.MaxValue))
            {
                if (alternative == (field == 0 ? 16u : field == 1 ? 2u : 1u)) continue;
                string? phase = null; bool refused = false;
                try { WindowsStorageBrokerServiceHeader.Verify(field == 0 ? alternative : 16, field == 1 ? alternative : 2, field == 2 ? alternative : 1, value => phase = value); }
                catch (InvalidOperationException) { refused = true; }
                if (!refused || phase is null || phase.Length > 80 || !phase.All(c => char.IsAsciiLetter(c) || c == '-')) throw new InvalidOperationException("A non-original service configuration was accepted or leaked an unbounded diagnostic.");
                if (field == 0 && phase != "service-absence-configuration-header-type" || field == 1 && !phase.StartsWith("service-absence-configuration-header-start-", StringComparison.Ordinal) || field == 2 && !phase.StartsWith("service-absence-configuration-header-error-", StringComparison.Ordinal)) throw new InvalidOperationException("The wrong service header invariant was reported.");
                checks++;
            }
        }
        if (checks != 769) throw new InvalidOperationException("The complete service header guard inventory did not execute.");
        return checks;
    }
}
