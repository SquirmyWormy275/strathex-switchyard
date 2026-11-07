import assert from "node:assert/strict";
import test from "node:test";
import { codexTerminalConnectionArguments, codexTerminalResumeArguments } from "../src/codex-terminal.ts";
const id = "019a36f0-1345-7345-b123-123456789abc";

test("exact Codex resume pins the explicit local socket, repository and read-only approval policy without a prompt", () => {
  const args = codexTerminalResumeArguments(id, "/repo with spaces", "/private/control.sock");
  assert.deepEqual(args, ["resume", "--remote", "unix:///private/control.sock", "--sandbox", "read-only", "--ask-for-approval", "on-request", "--cd", "/repo with spaces", id]);
  assert.equal(Object.isFrozen(args), true); assert.equal(Object.isFrozen(codexTerminalConnectionArguments("/repo", "/private/control.sock")), true);
});

test("names, recent-session selectors, malformed identifiers and command text cannot become resume targets", () => {
  for (const value of ["", "--last", "--all", "same-name", "thread-created", id + " prompt", id + "\n", "../" + id]) assert.throws(() => codexTerminalResumeArguments(value, "/repo", "/private/control.sock"), /returned session UUID/);
});

test("remote URLs, ambiguous socket paths and overlong Unix addresses refuse before a launch", () => {
  for (const value of ["unix://", "wss://example.invalid", "relative.sock", "/tmp/../private/sock", "/private//sock", "/private/a sock", "/private/a#sock", "/private/a?sock", "/private/a%sock", "/private/a\\sock", "/private/a\0sock", "/" + "x".repeat(103), "/" + "é".repeat(52)]) assert.throws(() => codexTerminalConnectionArguments("/repo", value), /socket/);
  assert.ok(codexTerminalConnectionArguments("/repo", "/" + "x".repeat(102)).includes("unix:///" + "x".repeat(102)));
});

test("relative, normalized-away, control and ambiguous repository paths cannot be passed to the CLI", () => {
  for (const value of ["relative", "/repo/../other", "/repo//other", "/repo\nother", "/repo\\other", "/" + "x".repeat(4096)]) assert.throws(() => codexTerminalConnectionArguments(value, "/private/control.sock"), /repository path/);
});
