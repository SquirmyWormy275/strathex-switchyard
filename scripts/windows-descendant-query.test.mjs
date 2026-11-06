import test from "node:test";
import assert from "node:assert/strict";
import { descendantQueryRequest, descendantQueryReply, createWindowsDescendantQuery } from "./windows-descendant-query.mjs";

const request = change => ({ schema: "switchyard-descendant-query/v1", nonce: "a".repeat(32), sequence: 1, role: "guardian", pid: 123, birth: null, executableSha256: "b".repeat(64), ...change });
const reply = input => ({ ...input, birth: input.birth ?? "638000000000000000", status: "verified", grantedMask: 8 });
test("CI descendant registration admits only a closed bounded role and exact process/image identity", () => {
  for (const role of ["guardian", "worker", "status"]) {
    const input = request({ role, birth: role === "worker" ? "638000000000000000" : null });
    assert.deepEqual(descendantQueryRequest(input), input); assert.notEqual(descendantQueryRequest(input), input);
  }
  for (const change of [{ schema: "other" }, { nonce: "A".repeat(32) }, { sequence: 0 }, { sequence: 65 }, { sequence: 1.1 }, { role: "arbitrary" },
    { pid: 0 }, { pid: 0x100000000 }, { pid: 1.5 }, { pid: "123" }, { birth: "1" }, { role: "worker" }, { role: "worker", birth: "0" },
    { role: "worker", birth: "01" }, { role: "worker", birth: "1".repeat(20) }, { executableSha256: "B".repeat(64) }, { tokenMask: 10 }, { path: "private" }]) {
    assert.throws(() => descendantQueryRequest(request(change)));
  }
  for (const key of Object.keys(request())) { const value = request(); delete value[key]; assert.throws(() => descendantQueryRequest(value)); }
  assert.equal(descendantQueryRequest(request({ sequence: 64, pid: 0xffffffff })).sequence, 64);
});
test("CI descendant replies cannot substitute a different request, worker birth, mask or incomplete result", () => {
  for (const role of ["guardian", "worker", "status"]) {
    const input = request({ role, birth: role === "worker" ? "638000000000000000" : null }), output = reply(input);
    assert.deepEqual(descendantQueryReply(output, input), output); assert.notEqual(descendantQueryReply(output, input), output);
    for (const change of [{ schema: "other" }, { nonce: "c".repeat(32) }, { sequence: 2 }, { role: "other" }, { pid: 124 }, { executableSha256: "c".repeat(64) },
      { birth: null }, { birth: "0" }, { grantedMask: 10 }, { grantedMask: "8" }, { status: "apply-requested" }, { secret: "private" }]) assert.throws(() => descendantQueryReply({ ...output, ...change }, input));
    for (const key of Object.keys(output)) { const value = { ...output }; delete value[key]; assert.throws(() => descendantQueryReply(value, input)); }
    if (role === "worker") assert.throws(() => descendantQueryReply({ ...output, birth: "638000000000000001" }, input));
  }
  for (const value of [null, [], "verified", {}]) assert.throws(() => descendantQueryReply(value, request()));
});
test("the descendant registration client refuses an unbound host before filesystem or process access", () => {
  assert.throws(() => createWindowsDescendantQuery({ serviceImageSha256: "b".repeat(64) }, "/not-the-owned-context"));
});
