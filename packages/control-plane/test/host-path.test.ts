import assert from "node:assert/strict";
import test from "node:test";

import { exactHostAbsoluteRoot, hostRootKey } from "../src/host-path.ts";

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
