import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const deployment = join(root, "deployment", "windows");
const recipeIds = [
  "full_sandbox",
  "quarantine",
  "pipeline_local_gate",
  "pipeline_clean_reproduction",
  "shield_change_scan",
  "shield_codebase_audit",
  "shield_supply_chain",
  "release_shield"
] as const;

test("Windows release packages and attests the pinned Job-Object helper", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  for (const expected of [
    "RepositoryRuntimeHelperPath",
    "RepositoryRuntimeHelperSha256",
    "repository-runner-helper\\Sxsy.B122.RepositoryRunner.csproj",
    "b122-repository-runner.exe",
    "repositoryRuntimeHelperSha256",
    "--self-test"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
  assert.match(artifact, /repositoryRuntimeHelperSha256/);
  assert.match(artifact, /repository-runner-helper\/Program\.cs/);
  assert.match(portable, /repositoryRuntimeContainmentSelfTest=\$true/);
  assert.match(start, /b122-repository-runner\.exe/);
});

test("Windows release packages, self-tests, and provenance-binds the native voice helper", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const start = await readFile(join(deployment, "Start-B122.ps1"), "utf8");
  const routes = await readFile(join(deployment, "Manage-B122VoiceRoute.ps1"), "utf8");
  for (const expected of [
    "VoiceHelperPath",
    "VoiceHelperSha256",
    "voice-helper\\Sxsy.B122.VoiceHelper.csproj",
    "sxsy-b122-voice-helper.exe",
    "sxsy-b122.voice-helper-self-test",
    "voiceHelperSha256",
    "Manage-B122VoiceRoute.ps1"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
  assert.match(artifact, /voiceHelperSha256/);
  assert.match(artifact, /voice-helper\/Program\.cs/);
  assert.match(artifact, /Manage-B122VoiceRoute\.ps1/);
  assert.match(portable, /voiceHelperSelfTest=\$true/);
  assert.match(portable, /unconsented portable companion launched the voice helper/);
  assert.match(start, /sxsy-b122-voice-helper\.exe/);
  assert.match(routes, /credential-ref:(?:claude|chatgpt)-current-user/);
  assert.match(routes, /Exact current-user confirmation/);
  assert.match(routes, /Test-B122ReleaseArtifact\.ps1/);
  assert.match(routes, /Assert-VoiceHelperIdentity/);
  assert.match(routes, /voiceHelperSha256/);
  assert.match(routes, /ReparsePoint/);
});

test("evidence-eligible release requires and hashes a compiler-bound firmware receipt", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");
  for (const expected of ["--require-c-compiler", "--receipt", "firmware-verification.json", "compiler.fingerprintSha256"]) {
    assert.equal(build.includes(expected), true, `release build is missing ${expected}`);
    assert.equal(artifact.includes(expected === "--require-c-compiler" || expected === "--receipt" ? "compilerRequired" : expected), true, `release validation is missing ${expected}`);
  }
  assert.match(artifact, /payload checksum manifest/);
  assert.match(artifact, /development-only release must not present a compiler receipt/);
});

test("deployment templates expose every typed recipe and never pretend the supervisor is a project command", async () => {
  const runtimePlan = JSON.parse(await readFile(join(deployment, "repository-runtime-plan.template.json"), "utf8")) as { recipes: Record<string, { executable?: string }> };
  const sandboxPlan = JSON.parse(await readFile(join(deployment, "windows-sandbox-catalog-plan.template.json"), "utf8")) as { recipes: Record<string, { executable: string; arguments: string[]; artifacts: string[] }> };
  const recipes = JSON.parse(await readFile(join(deployment, "typed-recipes.template.json"), "utf8")) as { recipes: Record<string, { executableSha256: string; coverage: unknown[] }> };
  assert.doesNotMatch(JSON.stringify(runtimePlan), /b122-repository-runner\.exe/);
  for (const recipeId of recipeIds) {
    assert.deepEqual(sandboxPlan.recipes[recipeId]?.arguments.slice(0, 2), ["--recipe", recipeId]);
    assert.equal(sandboxPlan.recipes[recipeId]?.executable.endsWith("b122-repository-runner.exe"), true);
    assert.deepEqual(sandboxPlan.recipes[recipeId]?.artifacts, ["b122-recipe-evidence.json"]);
    assert.equal(recipes.recipes[recipeId]?.executableSha256, "0".repeat(64));
    assert.ok((recipes.recipes[recipeId]?.coverage.length ?? 0) > 0);
  }
});
