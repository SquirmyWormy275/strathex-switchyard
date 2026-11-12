/** Read-only original ibm-capsense-usb 0.9.0 expansion report; never a Vial setting. */
export const originalExpansionSource = Object.freeze({
  version: "0.9.0", url: "https://static.wongcornall.com/ibm-capsense-usb/0.9.0/ibm-capsense-usb_0.9.0.tar.gz",
  archiveSha256: "50ad711d35d50245f513f8c41a74048788184de1a31e9401a53519827a95397f",
  diagnosticSha256: "e20ce3b923d1f702bc852eda35d02e800c4c4e36ef0f618b5a1aab71640c11c7",
  modesSha256: "5891d314edf2feac7c0620bba17069979e4be7bca2e823876155b22c801b2a9f"
});
const switches = ["caps-lock", "num-lock", "shift-lock", "fn1-lock", "fn2-lock", "fn3-lock"];
export function decodeOriginalExpansion(response) {
  const r = Buffer.from(response);
  if (r.length !== 8 || r[0] !== 10 || r.subarray(4).some(n => n !== 0)) throw new Error("The original expansion report is malformed or uses an unsupported contract.");
  const modeCode = r[1], modeKnown = modeCode <= 14, solenoidMode = modeCode === 1 || modeCode >= 3 && modeCode <= 14, switchIndex = Math.floor((modeCode - 3) / 2);
  return { schema: "switchyard-original-expansion/v1", firmwareVersion: "0.9.0", modeCode, modeKnown,
    configuredFunction: !modeKnown ? "unknown" : modeCode === 0 ? "disabled" : modeCode === 2 ? "lock-led-output" : "solenoid-or-buzzer",
    rawValues: [r[2], r[3]], timing: solenoidMode ? { extendMs: r[2], retractMs: r[3] } : null,
    lockSwitch: solenoidMode && modeCode >= 3 ? { function: switches[switchIndex], contact: modeCode % 2 ? "normally-open" : "normally-closed" } : null,
    configurationReadVerified: true, controlAvailable: false, hardwarePresenceVerified: false, electricalLimitsVerified: false, hostLockStateVerified: false,
    provenance: "Original ibm-capsense-usb 0.9.0 diagnostic state 10; configured values only", source: originalExpansionSource };
}
