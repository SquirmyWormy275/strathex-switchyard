/** Pinned build declarations describe source support; they never authorize device control. */
import sourceManifest from "./catalog-source.mjs";
import protocolAudits from "../../third_party/model-f-catalog/HAPTIC_PROTOCOL_AUDIT.json" with { type: "json" };
import { identifyCatalogSnapshot } from "./catalog-identity.mjs";

const profiles = [
  { definitionId: "wcass:f77", owner: "ploxiln", repository: "ploxiln/vial-qmk", commit: "c832c9b0edfa554c6e8344cb732f14620e63b210", vialProtocol: 4, keyboardId: "0103044704470912", definitionSha256: "fe56ba6c2de3f27f4e92d8589e2a7e32ee7232f9f7b5447d74a74127ab54cb13", buildFile: "keyboards/xwhatsit/brand_new_model_f/f77/wcass/rules.mk", buildSha256: "836a228e4f4b30cca87bf2b3786ae38823f957de74802d4607e685fbc5abb5a4", buildGitBlob: "c88b66ca835dba82ae0b8815ba38340bd8be4cfd", declaration: "HAPTIC_ENABLE += SOLENOID" },
  { definitionId: "leyden:f77:vial", owner: "mymakercorner", repository: "mymakercorner/vial-qmk", commit: "761cb1c1b71ed91c48185f3e03465702b21e49f4", vialProtocol: 6, keyboardId: "eeee40bd391049dd", definitionSha256: "7456868f0c82b2a654cc1737a3f296b7c5ed5e4f4b4a94f5d1d14a53aa32b725", buildFile: "keyboards/leyden_jar/f77/rules.mk", buildSha256: "d27327cb0f0456eb6574a58de7bac6ff1d92bba05cc4f0d139a10861984177a0", buildGitBlob: "f4ebc214c509a06df1202acc0468911d709f143b", declaration: "HAPTIC_ENABLE = yes; HAPTIC_DRIVER = solenoid" }
];

export function inspectSourceHaptics(catalog, snapshot) {
  const base = { schema: "switchyard-haptic-capabilities/v1", capturedAt: snapshot?.capturedAt ?? null, sourceSupport: "unverified", source: null, protocolAudit: null, driver: null, liveState: "unavailable", controlAvailability: "unavailable", timingLimits: "unverified", firmwareAuthenticated: false, physicalHardwareVerified: false, electricalLimitsVerified: false, allowedOperations: [], hidTransactions: 0 };
  let identity; try { identity = identifyCatalogSnapshot(catalog, snapshot); } catch { return { ...base, reason: "The protected readout does not verify an exact source identity." }; }
  const matches = profiles.filter(profile => identity.status === "source-identity-match" && snapshot.identity.viaProtocol === 9 && snapshot.identity.vialProtocol === profile.vialProtocol && snapshot.identity.keyboardId === profile.keyboardId && identity.definitionSha256 === profile.definitionSha256 && identity.definitions.some(definition => definition.id === profile.definitionId && definition.uidMatches) && sourceManifest.commits[profile.owner] === profile.commit);
  if (matches.length !== 1) return { ...base, reason: "This readout has no uniquely matched pinned haptic build declaration. Existing device settings are preserved." };
  const profile = matches[0];
  const audits = protocolAudits.builds.filter(audit => audit.definitionId === profile.definitionId && audit.repository === profile.repository && audit.commit === profile.commit && audit.viaProtocol === 9 && audit.vialProtocol === profile.vialProtocol);
  const protocolAudit = audits.length === 1 ? structuredClone({ schema: protocolAudits.schema, scope: protocolAudits.scope, provenance: protocolAudits.provenance, ...audits[0] }) : null;
  const reason = protocolAudit ? "The matched source declares solenoid support. Its audited direct VIA/Vial routes expose no haptic state/control operation. Source identity does not verify running firmware, fitted hardware, live state or electrical limits." : "The matched source declares solenoid support. This configuration readout does not verify live solenoid state, fitted hardware or an approved control path.";
  return { ...base, sourceSupport: "declared-solenoid", driver: "solenoid", protocolAudit, source: { definitionId: profile.definitionId, repository: profile.repository, commit: profile.commit, file: profile.buildFile, sha256: profile.buildSha256, gitBlobSha: profile.buildGitBlob, url: `https://github.com/${profile.repository}/blob/${profile.commit}/${profile.buildFile}`, declaration: profile.declaration }, reason };
}
