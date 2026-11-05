/** Validate CI proof claims only. This cannot create a token, grant trust or accept a guest/account. */
import assert from "node:assert/strict";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const verified = ["success", "primaryTokenVerified", "sameUserVerified", "mediumIntegrityVerified", "administratorsDenyOnlyVerified", "volumePrivilegeAbsentVerified", "onlyTraversePrivilegeAssignedVerified", "tokenRecheckedAfterExit", "treeExitVerified", "creatorQuotaRestoredVerified", "restrictingSidListVerified"];
export function verifyRestrictedOwnerReport(result) {
  assert.equal(result?.success, true); const proof = result.nativeRestrictedHostProof;
  assert.ok(object(proof));
  const fields = ["schema", ...verified, "processCreationApi", "creatorPrivileges", "restrictingSidCount", "historicalFilteredFlags", "hostOwnerChecks", "hostOwner", "ordinaryUserAccountAccepted", "guestLaunched", "accountCreated"];
  assert.deepEqual(Object.keys(proof).sort(), fields.sort());
  assert.equal(proof.schema, "switchyard-restricted-host-process-proof/v1");
  for (const key of verified) assert.equal(proof[key], true);
  assert.equal(proof.processCreationApi, "CreateProcessAsUserW"); assert.equal(proof.restrictingSidCount, 4); assert.equal(proof.hostOwnerChecks, 8);
  for (const key of ["ordinaryUserAccountAccepted", "guestLaunched", "accountCreated"]) assert.equal(proof[key], false);
  assert.ok(Array.isArray(proof.historicalFilteredFlags)); assert.equal(proof.historicalFilteredFlags.length, 3); assert.ok(proof.historicalFilteredFlags.every(value => typeof value === "boolean"));
  const privileges = proof.creatorPrivileges;
  assert.ok(object(privileges)); assert.deepEqual(Object.keys(privileges).sort(), ["quotaAssigned", "quotaEnabled", "assignPrimaryAssigned", "assignPrimaryEnabled", "impersonateAssigned", "impersonateEnabled"].sort()); assert.ok(Object.values(privileges).every(value => typeof value === "boolean")); assert.equal(privileges.quotaAssigned, true);
  const owner = proof.hostOwner; assert.ok(object(owner)); assert.equal(owner.schema, "switchyard-native-broker-owner-proof/v1"); assert.equal(owner.success, true); assert.ok(Array.isArray(owner.checks)); assert.equal(owner.checks.length, 8); assert.ok(owner.checks.every(value => typeof value === "string" && value.length > 0 && value.length <= 512));
  for (const key of ["nativeExitVerified", "fixtureRemoved"]) assert.equal(owner[key], true);
  for (const key of ["ordinaryUserToken", "guestLaunched", "setupRequested", "accountCreated"]) assert.equal(owner[key], false);
  return proof;
}
