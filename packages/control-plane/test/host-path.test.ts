import assert from "node:assert/strict";
import test from "node:test";

import { exactHostAbsoluteRoot, exactPortableAbsoluteRoot, hostRootKey, portableRootKey } from "../src/host-path.ts";

test("host roots preserve Linux case while normalizing exact POSIX paths", () => {
  assert.equal(exactHostAbsoluteRoot("/home/Alex/Repo", "linux"), true);
  assert.equal(hostRootKey("/home/Alex/Repo", "linux"), "/home/Alex/Repo");
  assert.notEqual(hostRootKey("/home/Alex/Repo", "linux"), hostRootKey("/home/alex/repo", "linux"));
  assert.equal(exactHostAbsoluteRoot("/home/Alex/../Repo", "linux"), false);
  assert.equal(exactHostAbsoluteRoot("relative/repo", "linux"), false);
});

test("host roots preserve strict Windows validation and case-insensitive identity", () => {
  assert.equal(exactHostAbsoluteRoot("C:\\Work\\Repo", "win32"), true);
  assert.equal(exactHostAbsoluteRoot("C:/Work/Repo", "win32"), true);
  assert.equal(hostRootKey("C:\\Work\\Repo", "win32"), "c:/work/repo");
  assert.equal(hostRootKey("C:\\Work\\Repo", "win32"), hostRootKey("c:\\work\\repo", "win32"));
  assert.equal(exactHostAbsoluteRoot("C:\\Work\\..\\Repo", "win32"), false);
});

test("durable protocol roots preserve canonical Windows and Linux identities without conflating them", () => {
  assert.equal(exactPortableAbsoluteRoot("C:\\Work\\Repo"), true);
  assert.equal(exactPortableAbsoluteRoot("/home/alex/repo"), true);
  assert.equal(exactPortableAbsoluteRoot("relative/repo"), false);
  assert.equal(portableRootKey("C:\\Work\\Repo"), "win32:c:/work/repo");
  assert.equal(portableRootKey("/home/alex/repo"), "linux:/home/alex/repo");
  assert.notEqual(portableRootKey("C:\\Work\\Repo"), portableRootKey("/home/alex/repo"));
});
