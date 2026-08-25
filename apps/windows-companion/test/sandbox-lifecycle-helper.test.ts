import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const helperRoot = join(process.cwd(), "apps", "windows-companion", "sandbox-lifecycle-helper");

test("native sandbox lifecycle helper binds launch, focus, and termination to an exact non-reused process", async () => {
  const source = await readFile(join(helperRoot, "Program.cs"), "utf8");
  for (const required of [
    "C:\\\\Windows\\\\System32\\\\WindowsSandbox.exe",
    "CreateProcessW",
    "CREATE_SUSPENDED",
    "ResumeThread",
    "QueryFullProcessImageNameW",
    "GetProcessTimes",
    "GetFileInformationByHandle",
    "ProcessIdToSessionId",
    "EnumWindows",
    "GetWindowThreadProcessId",
    "SetForegroundWindow",
    "TerminateProcess",
    "WaitForSingleObject"
  ]) {
    assert.equal(source.includes(required), true, `native lifecycle helper is missing ${required}`);
  }
  assert.match(source, /CaptureExactIdentity[\s\S]{0,2400}GetProcessTimes/);
  assert.match(source, /Focus[\s\S]{0,3000}CaptureExactIdentity[\s\S]{0,3000}SetForegroundWindow/);
  assert.match(source, /Terminate[\s\S]{0,3000}CaptureExactIdentity[\s\S]{0,3000}TerminateProcess/);
  assert.match(source, /--self-test/);
  assert.match(source, /sxsy-b122\.sandbox-lifecycle-self-test/);
});

test("native sandbox lifecycle helper is a deterministic fixed Windows executable", async () => {
  const project = await readFile(join(helperRoot, "Sxsy.B122.SandboxLifecycleHelper.csproj"), "utf8");
  assert.match(project, /<RuntimeIdentifier>win-x64<\/RuntimeIdentifier>/);
  assert.match(project, /<SelfContained>true<\/SelfContained>/);
  assert.match(project, /<PublishSingleFile>true<\/PublishSingleFile>/);
  assert.match(project, /<TreatWarningsAsErrors>true<\/TreatWarningsAsErrors>/);
  assert.match(project, /<AssemblyName>b122-sandbox-lifecycle<\/AssemblyName>/);
});
