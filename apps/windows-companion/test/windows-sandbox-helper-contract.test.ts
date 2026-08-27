import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const helperRoot = join(process.cwd(), "apps", "windows-companion", "sandbox-helper");

test("native sandbox helper uses a suspended-process Job Object boundary with hard resource ceilings", async () => {
  const source = await readFile(join(helperRoot, "Program.cs"), "utf8");
  for (const required of [
    "CreateJobObjectW",
    "SetInformationJobObject",
    "JobObjectExtendedLimitInformation",
    "JobObjectCpuRateControlInformation",
    "JOB_OBJECT_LIMIT_ACTIVE_PROCESS",
    "JOB_OBJECT_LIMIT_PROCESS_MEMORY",
    "JOB_OBJECT_LIMIT_JOB_MEMORY",
    "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
    "JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP",
    "CreateProcessW",
    "CREATE_SUSPENDED",
    "AssignProcessToJobObject",
    "ResumeThread",
    "TerminateJobObject",
    "QueryInformationJobObject"
  ]) {
    assert.equal(source.includes(required), true, `native helper is missing ${required}`);
  }
  assert.match(source, /activeProcessesAfterCleanup\s*=\s*0/);
  assert.match(source, /noSurvivors\s*=\s*true/);
});

test("helper binds exact v2 profile and resource policy and always requests guest shutdown", async () => {
  const source = await readFile(join(helperRoot, "Program.cs"), "utf8");
  assert.match(source, /RequestVersion\s*=\s*2/);
  assert.match(source, /"profile"/);
  assert.match(source, /"resourcePolicy"/);
  assert.match(source, /"resourcePolicyDigest"/);
  assert.match(source, /full_sandbox/);
  assert.match(source, /fresh_full_sandbox/);
  assert.match(source, /quarantine/);
  assert.match(source, /RequireWindowsSandboxGuest/);
  assert.match(source, /WDAGUtilityAccount/);
  assert.match(source, /finally[\s\S]{0,300}RequestSandboxShutdown/);

  const requestSchema = JSON.parse(await readFile(join(helperRoot, "request.schema.json"), "utf8")) as Record<string, unknown>;
  const resultSchema = JSON.parse(await readFile(join(helperRoot, "result.schema.json"), "utf8")) as Record<string, unknown>;
  assert.equal((requestSchema.properties as Record<string, { const?: unknown }>).version?.const, 2);
  assert.equal((resultSchema.properties as Record<string, { const?: unknown }>).version?.const, 2);
  assert.deepEqual((requestSchema.required as string[]).slice(-3), ["resourcePolicy", "resourcePolicyDigest", "helperDigest"]);
  assert.equal((resultSchema.required as string[]).includes("resourceEnforcement"), true);
});
