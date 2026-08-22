# Windows companion

The companion currently owns packet validation, anti-replay sequencing, device
disconnect cleanup, and truthful intent classification. A future Raw HID adapter
must provide a fresh, host-vetted connection ID at each device connection epoch;
this permits a restarted firmware sequence without accepting replays in an
existing connection. It produces displayable intents only. There is
no Raw HID device driver, process launcher, terminal control, Git command,
credential access, network access, test runner, or automation adapter here.

The next implementation must add those integrations behind distinct mediator
brokers and prove the relevant acceptance gates before changing the policy from
preview-only.
