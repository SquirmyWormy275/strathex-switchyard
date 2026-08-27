import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const deployment = join(root, "deployment", "windows");

test("the Windows release packages, self-tests, inventories, and provenance-checks the provider host", async () => {
  const build = await readFile(join(deployment, "Build-B122Release.ps1"), "utf8");
  const portable = await readFile(join(deployment, "Test-B122PortableBundle.ps1"), "utf8");
  const artifact = await readFile(join(deployment, "Test-B122ReleaseArtifact.ps1"), "utf8");

  for (const expected of [
    "package:provider-host:dry-run",
    "build:provider-host",
    "provider-adapter-host",
    "sxsy-b122.provider-host-self-test",
    "providerAdapterHost=[string]$providerPackageIdentity.version",
    "SPDXRef-Package-ProviderAdapterHost"
  ]) assert.equal(build.includes(expected), true, `release build is missing ${expected}`);

  for (const expected of [
    "providerHostMain",
    "sxsy-b122.provider-host-self-test",
    "providerHostSelfTest=$true",
    "proprietaryCredentialAccessed -ne $false",
    "networkAccessed -ne $false"
  ]) assert.equal(portable.includes(expected), true, `portable smoke is missing ${expected}`);

  for (const expected of [
    "@strathex/switchyard-provider-adapter-host",
    "providerAdapterHost",
    "SPDXRef-Package-ProviderAdapterHost",
    "apps/provider-adapter-host/src/main.ts",
    "apps/provider-adapter-host/src/service.ts",
    "apps/provider-adapter-host/src/backends.ts",
    "apps/provider-adapter-host/src/state.ts"
  ]) assert.equal(artifact.includes(expected), true, `release validation is missing ${expected}`);
});

test("provider companion provisioning loads the self-contained packaged extension transport", async (context) => {
  const fixture = await mkdtemp(join(tmpdir(), "b122-provider-provision-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const bundle = join(fixture, "bundle");
  const transport = join(bundle, "extension", "dist", "apps", "vscode-extension", "src", "named-pipe-transport.js");
  const artifactPath = join(fixture, "companion-provisioning.json");
  await mkdir(dirname(transport), { recursive: true });
  await writeFile(join(bundle, "extension", "package.json"), JSON.stringify({ type: "commonjs" }), "utf8");
  await writeFile(transport, `exports.ProvisionedNamedPipeJsonLineTransport = class {
  async request(value) {
    const request = JSON.parse(value);
    const result = request.method === "credential.provision"
      ? { credential: { reference: request.payload.reference } }
      : request.method === "network-policy.install"
        ? { policy: { status: "active" } }
        : { profile: { configurationSha256: request.payload.profile.configurationSha256 } };
    return JSON.stringify({ version: 1, id: request.id, ok: true, result });
  }
};\n`, "utf8");
  const repositoryRoot = root;
  const configurationPath = join(fixture, "provider-host.json");
  const bearerReference = `b122-provider-bearer-${"b".repeat(64)}`;
  const dispatchReference = `b122-provider-dispatch-lease-${"d".repeat(64)}`;
  const profile = {
    schema: "sxsy-b122.provider-host-dispatch-profile", version: 1, generation: 1,
    expectedPriorConfigurationSha256: null, expectedPriorProfileDigest: null,
    repositoryRoot, configurationPath, configurationSha256: "a".repeat(64), tlsSpkiSha256: "c".repeat(64),
    bearerCredentialReference: bearerReference, dispatchLeaseCredentialReference: dispatchReference,
    providers: [{ provider: "codex", adapterId: "sxsy-b122.fixture.codex", moduleSha256: "e".repeat(64) }]
  } as const;
  const profileDigest = dispatchProfileDigest(profile);
  await writeFile(artifactPath, JSON.stringify({
    schema: "sxsy-b122.provider-host-companion-provisioning", version: 2,
    credentials: [
      { role: "bearer", reference: bearerReference, scopes: [{ repositoryRoot, adapterId: "configured-network", purpose: "provider-api" }], sealedSecret: "YQ==", protector: "windows-dpapi-current-user" },
      { role: "dispatch-lease", reference: dispatchReference, scopes: [{ repositoryRoot, adapterId: "provider-dispatch-lease-issuer", purpose: "provider-dispatch-lease" }], sealedSecret: "Yg==", protector: "windows-dpapi-current-user" }
    ],
    networkPolicyPath: join(fixture, "network-policy.json"), profile: { ...profile, profileDigest }
  }), "utf8");

  const receipt = JSON.parse(await run(process.execPath, [join(deployment, "Provision-B122ProviderHostCompanion.mjs"), "--artifact", artifactPath, "--bundle-root", bundle]));
  assert.equal(receipt.schema, "sxsy-b122.provider-host-companion-provisioning-receipt");
  assert.equal(receipt.status, "provisioned");
  assert.equal(receipt.authenticatedPipe, true);
  assert.equal(receipt.cleartextSecretRead, false);
  assert.equal(receipt.sealedSecretCount, 2);
  assert.equal(receipt.repositoryRoot, repositoryRoot);
  await assert.rejects(() => run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], 100), /timed out/i);
});

function dispatchProfileDigest(profile: Readonly<{
  repositoryRoot: string;
  configurationPath: string;
  configurationSha256: string;
  tlsSpkiSha256: string;
  bearerCredentialReference: string;
  dispatchLeaseCredentialReference: string;
  providers: readonly Readonly<{ provider: string; adapterId: string; moduleSha256: string }>[];
}>): string {
  const path = (value: string) => value.replaceAll("/", "\\").replace(/\\+$/u, "").toLowerCase();
  const providers = [...profile.providers].sort((left, right) => left.provider.localeCompare(right.provider))
    .map((entry) => `${entry.provider}\0${entry.adapterId}\0${entry.moduleSha256}\0`).join("");
  return createHash("sha256").update(`sxsy-b122.provider-host-dispatch-profile\0v1\0${path(profile.repositoryRoot)}\0${path(profile.configurationPath)}\0${profile.configurationSha256}\0${profile.tlsSpkiSha256}\0${profile.bearerCredentialReference}\0${profile.dispatchLeaseCredentialReference}\0${providers}`, "utf8").digest("hex");
}

function run(executable: string, args: readonly string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { cwd: root, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let capturedBytes = 0; let outputOversized = false; let timedOut = false; let termination: Promise<void> | undefined;
    const capture = (target: Buffer[], chunk: unknown) => {
      const bytes = Buffer.from(chunk as Uint8Array); const remaining = Math.max(0, 64 * 1024 - capturedBytes);
      if (bytes.length > remaining) outputOversized = true;
      if (remaining) { const value = bytes.subarray(0, remaining); target.push(value); capturedBytes += value.length; }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    const timer = setTimeout(() => { timedOut = true; termination = terminateExactTree(child); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); rejectRun(error); });
    child.once("close", async (code) => {
      clearTimeout(timer);
      await termination;
      if (timedOut) { rejectRun(new Error(`provider companion provisioning timed out after ${timeoutMs}ms.`)); return; }
      if (outputOversized) { rejectRun(new Error("provider companion provisioning output exceeded its bounded capture.")); return; }
      code === 0
        ? resolveRun(Buffer.concat(stdout).toString("utf8"))
        : rejectRun(new Error(`provider companion provisioning failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}

function terminateExactTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid) { child.kill(); return Promise.resolve(); }
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    return Promise.resolve();
  }
  return new Promise((resolveTermination) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolveTermination(); } };
    const killer = spawn("C:\\Windows\\System32\\taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.once("error", () => { child.kill(); finish(); });
    killer.once("close", () => finish());
    setTimeout(() => { killer.kill(); child.kill(); finish(); }, 5_000).unref();
  });
}
