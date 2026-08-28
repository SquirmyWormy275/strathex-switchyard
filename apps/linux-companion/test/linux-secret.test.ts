import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { LinuxLibsecretCurrentUserProtector, type LinuxSecretToolRunner } from "../src/linux-secret.ts";

function memoryRunner(): LinuxSecretToolRunner {
  let stored: Buffer | undefined;
  return async (request) => {
    if (request.operation === "lookup") {
      return stored
        ? { exitCode: 0, stdout: Buffer.from(stored), stderr: Buffer.alloc(0) }
        : { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    stored?.fill(0);
    stored = Buffer.from(request.input);
    return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
}

test("Linux libsecret protector round-trips an authenticated envelope without embedding the master key", async () => {
  const protector = new LinuxLibsecretCurrentUserProtector(memoryRunner());
  const clear = randomBytes(64);
  const sealed = await protector.seal(clear);
  assert.match(sealed, /^linux-libsecret-v1:[A-Za-z0-9_-]+$/);
  assert.equal(sealed.includes(clear.toString("base64")), false);
  assert.deepEqual(await protector.open(sealed), clear);
  clear.fill(0);
});

test("Linux libsecret protector rejects tampering and a missing or locked Secret Service", async () => {
  const protector = new LinuxLibsecretCurrentUserProtector(memoryRunner());
  const sealed = await protector.seal(Buffer.from("bound secret"));
  const replacement = sealed.endsWith("A") ? "B" : "A";
  await assert.rejects(() => protector.open(`${sealed.slice(0, -1)}${replacement}`), /invalid|authenticate/i);

  const unavailable = new LinuxLibsecretCurrentUserProtector(async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }));
  await assert.rejects(() => unavailable.open(sealed), /invalid|authenticate/i);
});

test("Linux libsecret initialization confirms the stored key before sealing", async () => {
  let stores = 0;
  const runner: LinuxSecretToolRunner = async (request) => {
    if (request.operation === "store") { stores += 1; return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  const protector = new LinuxLibsecretCurrentUserProtector(runner);
  await assert.rejects(() => protector.seal(Buffer.from("never sealed")), /confirm|Secret Service|libsecret/i);
  assert.equal(stores, 1);
});

test("independent Linux protectors serialize first-use master-key creation", async () => {
  let stored: Buffer | undefined;
  let stores = 0;
  const runner: LinuxSecretToolRunner = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (request.operation === "lookup") return stored ? { exitCode: 0, stdout: Buffer.from(stored), stderr: Buffer.alloc(0) } : { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    stores += 1; stored?.fill(0); stored = Buffer.from(request.input);
    return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  let tail = Promise.resolve();
  const creationLock = async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return { async release() { release(); } };
  };
  const first = new LinuxLibsecretCurrentUserProtector(runner, creationLock);
  const second = new LinuxLibsecretCurrentUserProtector(runner, creationLock);
  const [sealedFirst, sealedSecond] = await Promise.all([first.seal(Buffer.from("first")), second.seal(Buffer.from("second"))]);
  assert.equal(stores, 1);
  assert.equal(Buffer.from(await second.open(sealedFirst)).toString("utf8"), "first");
  assert.equal(Buffer.from(await first.open(sealedSecond)).toString("utf8"), "second");
  await Promise.all([first.dispose(), second.dispose()]);
  stored?.fill(0);
});
