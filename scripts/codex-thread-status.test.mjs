import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { listCodexThreads, normalizeThreadList } from "./codex-thread-status.mjs";

test("Codex thread inventory distinguishes stored threads from live runtime states", () => {
  assert.deepEqual(normalizeThreadList({ data: [
    { id: "thread-one", name: "private prompt", status: { type: "notLoaded" } },
    { id: "thread-two", preview: "private code", status: { type: "active", activeFlags: ["waitingOnApproval"] } },
    { id: "thread-three", status: { type: "idle" } }
  ] }), [
    { id: "thread-one", observation: "not-observed" },
    { id: "thread-two", observation: "waiting-on-approval" },
    { id: "thread-three", observation: "idle" }
  ]);
  assert.throws(() => normalizeThreadList({ data: [{ id: "bad/thread", status: { type: "active" } }] }), /identity/);
});

test("read-only observer sends only initialize and thread/list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sxsy-codex-inventory-"));
  const fixture = join(directory, "fake-codex.mjs");
  try {
    await writeFile(fixture, `
let input='';process.stdin.on('data',chunk=>{input+=chunk;for(;;){const end=input.indexOf('\\n');if(end<0)break;const line=input.slice(0,end);input=input.slice(end+1);const msg=JSON.parse(line);if(msg.method==='initialize')process.stdout.write(JSON.stringify({id:1,result:{userAgent:'fixture'}})+'\\n');else if(msg.method==='thread/list')process.stdout.write(JSON.stringify({id:2,result:{data:[{id:'thread-fixture',status:{type:'notLoaded'},preview:'must-not-escape'}],nextCursor:null}})+'\\n');else if(msg.method!=='initialized')process.exit(99);}});
`, "utf8");
    const spawnFixture = (_path, _args, options) => spawn(process.execPath, [fixture], options);
    assert.deepEqual(await listCodexThreads(process.execPath, { spawnProcess: spawnFixture }), [{ id: "thread-fixture", observation: "not-observed" }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
