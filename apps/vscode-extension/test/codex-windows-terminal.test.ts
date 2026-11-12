import test from "node:test";
import assert from "node:assert/strict";
import { codexWindowsTerminalResume, windowsEditorEndpoint, windowsEditorLocalPath, windowsEditorTokenVariable } from "../src/codex-windows-terminal.ts";
const id = "019a36f0-1345-7345-b123-123456789abc", token = Buffer.alloc(32, 19).toString("base64url");
const endpoint = () => ({ url: "ws://127.0.0.1:43179/", authToken: token });

test("Windows resume uses the exact loopback endpoint and task with a terminal-local bearer and no command interpolation", () => {
  const root = "C:\\Reviewed Projects\\repository", input = endpoint(), result = codexWindowsTerminalResume(id, root, input);
  assert.deepEqual(result.shellArgs, ["resume", "--remote", input.url, "--remote-auth-token-env", windowsEditorTokenVariable, "--cd", root, id]);
  assert.deepEqual(result.env, { [windowsEditorTokenVariable]: token });assert.equal(JSON.stringify(result.shellArgs).includes(token), false);
  input.authToken = "changed";assert.equal(result.env[windowsEditorTokenVariable], token);
  assert(Object.isFrozen(result) && Object.isFrozen(result.env) && Object.isFrozen(result.shellArgs));
  assert.equal(codexWindowsTerminalResume(id, "D:\\", endpoint()).shellArgs.at(-2), "D:\\");
});

test("remote hosts, alternate URL spellings, credentials, ports and noncanonical bearer encodings refuse", () => {
  for (const url of ["ws://localhost:43179/", "ws://127.1:43179/", "ws://127.0.0.1:043179/", "ws://127.0.0.1:43179", "wss://127.0.0.1:43179/", "ws://127.0.0.1:1023/", "ws://127.0.0.1:65536/", "ws://user@127.0.0.1:43179/", "ws://127.0.0.1:43179/?token=secret", "ws://127.0.0.1:43179/#token", "ws://127.0.0.1:43179/path", "ws://[::1]:43179/", "ws://example.invalid:43179/"]) assert.throws(() => windowsEditorEndpoint({ ...endpoint(), url }));
  for (const authToken of ["", token + "=", "a".repeat(43), token + "\n", "a".repeat(42), token + "extra"]) assert.throws(() => windowsEditorEndpoint({ ...endpoint(), authToken }));
  assert.throws(() => windowsEditorEndpoint({ ...endpoint(), command: "never" }));
  assert.equal(windowsEditorEndpoint({ ...endpoint(), url: "ws://127.0.0.1:65535/" }).url, "ws://127.0.0.1:65535/");
});

test("ambiguous Windows paths and recent-task selectors cannot become launch arguments", () => {
  for (const path of ["relative", "C:relative", "C:/repo", "\\\\server\\share\\repo", "\\\\?\\C:\\repo", "C:\\repo\\..\\other", "C:\\repo\\", "C:\\repo\\\\other", "C:\\repo:stream", "C:\\repo. ", "C:\\NUL.txt", "C:\\COM1\\repo", "C:\\repo\nother", "C:\\repo?", "C:\\" + "a".repeat(4096)]) { assert.equal(windowsEditorLocalPath(path), false);assert.throws(() => codexWindowsTerminalResume(id, path, endpoint())); }
  for (const target of ["", "--last", "--all", "same name", id + " prompt", id + "\n", "00000000-0000-0000-0000-000000000000"]) assert.throws(() => codexWindowsTerminalResume(target, "C:\\repo", endpoint()));
  assert.equal(windowsEditorLocalPath("C:\\repo with spaces\\a&b $(literal)"), true);
});
