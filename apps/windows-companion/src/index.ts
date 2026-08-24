/**
 * Windows companion entry point placeholder. Platform-specific Raw HID device
 * discovery is intentionally deferred until the B122 hardware/firmware target
 * is selected and transport lifecycle gate 22 has a test harness.
 */
export { ControlRouter, type RouteContext, type RoutedIntent, type SessionState } from "./router.ts";
