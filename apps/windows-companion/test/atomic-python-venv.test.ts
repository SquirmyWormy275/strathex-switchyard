import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AtomicPythonVenvLifecycle,
  type ExactPythonProcessRequest,
  type ExactPythonProcessResult,
  type PythonVenvTerminalCoordinator
} from "../src/atomic-python-venv.ts";

const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

async function fixture(context: test.TestContext) {
  const temporary = await mkdtemp(join(tmpdir(), "sxsy-b122-atomic-venv-"));
  const root = await realpath(temporary);
  const repositoryPath = join(root, "repository");
  await mkdir(repositoryPath);
  const repositoryRoot = await realpath(repositoryPath);
  context.after(async () => { await rm(root, { recursive: true, force: true }); });
  return { root, repositoryRoot };
}

class FakePythonRunner {
  readonly calls: ExactPythonProcessRequest[] = [];
  failStep?: "create" | "install" | "check" | "identity" | "freeze";
  onCreate?: () => Promise<void>;

  async run(request: ExactPythonProcessRequest): Promise<ExactPythonProcessResult> {
    this.calls.push(request);
    const args = [...request.args];
    if (args[0] === "-I" && args[1] === "-m" && args[2] === "venv") {
      if (this.failStep === "create") return { exitCode: 1, stdout: "", stderr: "create failed" };
      const target = args[3]!;
      await mkdir(join(target, "Scripts"), { recursive: true });
      await writeFile(join(target, "Scripts", "python.exe"), "test interpreter", "utf8");
      await writeFile(join(target, "pyvenv.cfg"), "home = isolated-test", "utf8");
      await this.onCreate?.();
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args.includes("install")) return this.failStep === "install"
      ? { exitCode: 1, stdout: "", stderr: "install failed" }
      : { exitCode: 0, stdout: "", stderr: "" };
    if (args.includes("check")) return this.failStep === "check"
      ? { exitCode: 1, stdout: "", stderr: "check failed" }
      : { exitCode: 0, stdout: "No broken requirements found.\n", stderr: "" };
    if (args.includes("freeze")) return this.failStep === "freeze"
      ? { exitCode: 1, stdout: "", stderr: "freeze failed" }
      : { exitCode: 0, stdout: "example==1.2.3\n", stderr: "" };
    if (args[0] === "-I" && args[1] === "-c") {
      if (this.failStep === "identity") return { exitCode: 1, stdout: "", stderr: "identity failed" };
      const executable = await realpath(request.executable);
      const prefix = dirname(dirname(executable));
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({ executable, prefix, basePrefix: join(dirname(prefix), "base-python") })}\n`,
        stderr: ""
      };
    }
    throw new Error(`Unexpected fake Python invocation: ${request.executable} ${args.join(" ")}`);
  }
}

const detachedTerminals: PythonVenvTerminalCoordinator = {
  async detach() { return { detached: true, detail: "isolated-test terminals detached" }; }
};

async function basePython(root: string): Promise<{ path: string; sha256: string }> {
  const path = join(root, "python.exe");
  await writeFile(path, "pinned base python", "utf8");
  return { path, sha256: digest(await readFile(path)) };
}

async function createExistingEnvironment(repositoryRoot: string, runner: FakePythonRunner): Promise<void> {
  const python = join(repositoryRoot, ".venv", "Scripts", "python.exe");
  await mkdir(dirname(python), { recursive: true });
  await writeFile(python, "test interpreter", "utf8");
  await writeFile(join(repositoryRoot, ".venv", "pyvenv.cfg"), "home = isolated-test", "utf8");
  assert.equal((await runner.run({ executable: python, args: ["-I", "-c", "identity"], timeoutMs: 1_000, maxOutputBytes: 4_096 })).exitCode, 0);
  runner.calls.length = 0;
}

async function dependencyLock(repositoryRoot: string) {
  const requirements = [
    "example==1.2.3 \\",
    "    --hash=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ""
  ].join("\n");
  const requirementsPath = join(repositoryRoot, "requirements.lock");
  const wheelhousePath = join(repositoryRoot, "wheelhouse");
  await mkdir(wheelhousePath);
  await writeFile(join(wheelhousePath, "example-1.2.3-py3-none-any.whl"), "fixture wheel", "utf8");
  await writeFile(requirementsPath, requirements, "utf8");
  return { requirementsPath: "requirements.lock", requirementsSha256: digest(requirements), wheelhousePath: "wheelhouse" };
}

test("normal create builds in an owned sibling, installs only a pinned offline lock, and atomically promotes it", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  const dependencies = await dependencyLock(setup.repositoryRoot);
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner });

  const result = await lifecycle.execute({
    mode: "ensure",
    operationId: "normal-create",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256,
    dependencies
  });

  assert.equal(result.status, "completed", result.summary);
  assert.equal(result.pythonInterpreter, await realpath(join(setup.repositoryRoot, ".venv", "Scripts", "python.exe")));
  assert.equal(await access(join(setup.repositoryRoot, ".venv", "pyvenv.cfg")).then(() => true), true);
  assert.equal((await lstat(join(setup.repositoryRoot, ".venv"))).isDirectory(), true);
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).stagingPaths.length, 0);
  const create = runner.calls.find((call) => call.args[1] === "-m" && call.args[2] === "venv");
  assert.ok(create);
  assert.match(create.args[3] ?? "", /[\\/]\.b122-venv-staging-[a-f0-9]{64}$/);
  assert.equal(create.args.includes("--clear"), false);
  const install = runner.calls.find((call) => call.args.includes("install"));
  assert.ok(install);
  assert.equal(install.args.includes("--no-index"), true);
  assert.equal(install.args.includes("--require-hashes"), true);
  assert.equal(install.args.includes("--no-deps"), false);
  const privateWheelhouse = install.args[install.args.indexOf("--find-links") + 1] ?? "";
  assert.match(privateWheelhouse, /[\\/]\.venv[\\/]\.sxsy-b122-offline-input[\\/]wheelhouse$|[\\/]\.b122-venv-staging-[a-f0-9]{64}[\\/]\.sxsy-b122-offline-input[\\/]wheelhouse$/);
  assert.notEqual(privateWheelhouse, await realpath(join(setup.repositoryRoot, "wheelhouse")));
});

test("normal create reuses a verified environment and never mutates it in place", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  await createExistingEnvironment(setup.repositoryRoot, runner);
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner });

  const result = await lifecycle.execute({
    mode: "ensure",
    operationId: "reuse-existing",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });

  assert.equal(result.status, "completed");
  assert.equal(runner.calls.some((call) => call.args.includes("venv")), false);
  assert.equal(runner.calls.some((call) => call.args.includes("--clear")), false);
});

test("Shift rebuild requires confirmation and an authenticated terminal detach before swapping", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  await createExistingEnvironment(setup.repositoryRoot, runner);
  const blockedTerminals: PythonVenvTerminalCoordinator = {
    async detach() { return { detached: false, detail: "terminal 4 still uses the old interpreter" }; }
  };
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner, terminalCoordinator: blockedTerminals });

  const unconfirmed = await lifecycle.execute({
    mode: "rebuild",
    operationId: "unconfirmed",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });
  assert.equal(unconfirmed.status, "blocked");
  assert.match(unconfirmed.summary, /confirmation/i);
  assert.equal(runner.calls.length, 0);

  const blocked = await lifecycle.execute({
    mode: "rebuild",
    confirmed: true,
    operationId: "terminal-lock",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.summary, /terminal 4/i);
  assert.equal(await access(join(setup.repositoryRoot, ".venv")).then(() => true), true);
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).stagingPaths.length, 1);
  assert.equal(blocked.stagingPaths.length, 1);
  assert.ok(blocked.recoverySteps.some((step) => step.includes(".b122-venv-staging-")));
});

test("Shift rebuild preserves the old environment until replacement validation and removes recovery only after success", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  await createExistingEnvironment(setup.repositoryRoot, runner);
  await writeFile(join(setup.repositoryRoot, ".venv", "old-marker.txt"), "last known good", "utf8");
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner, terminalCoordinator: detachedTerminals });

  const result = await lifecycle.execute({
    mode: "rebuild",
    confirmed: true,
    operationId: "successful-rebuild",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });

  assert.equal(result.status, "completed");
  assert.equal(await access(join(setup.repositoryRoot, ".venv", "old-marker.txt")).then(() => true).catch(() => false), false);
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).recoveryPaths.length, 0);
  assert.equal(runner.calls.some((call) => call.args.includes("--clear")), false);
});

test("a Windows lock on the old environment preserves both the active and fully validated staging copies", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  await createExistingEnvironment(setup.repositoryRoot, runner);
  const active = resolve(setup.repositoryRoot, ".venv");
  const lifecycle = new AtomicPythonVenvLifecycle({
    processRunner: runner,
    terminalCoordinator: detachedTerminals,
    renamePath: async (source, destination) => {
      if (resolve(source) === active && destination.includes(".b122-venv-recovery-")) {
        const error = Object.assign(new Error("file in use"), { code: "EBUSY" });
        throw error;
      }
      await rename(source, destination);
    }
  });

  const result = await lifecycle.execute({
    mode: "rebuild",
    confirmed: true,
    operationId: "locked-old",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /locked|file in use/i);
  assert.equal(await access(active).then(() => true), true);
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).stagingPaths.length, 1);
  assert.ok(result.recoverySteps.some((step) => step.includes("Close or detach")));
});

test("a failed replacement rename rolls the recovery copy back to .venv and preserves staging", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  await createExistingEnvironment(setup.repositoryRoot, runner);
  await writeFile(join(setup.repositoryRoot, ".venv", "old-marker.txt"), "last known good", "utf8");
  const active = resolve(setup.repositoryRoot, ".venv");
  let denied = false;
  const lifecycle = new AtomicPythonVenvLifecycle({
    processRunner: runner,
    terminalCoordinator: detachedTerminals,
    renamePath: async (source, destination) => {
      if (!denied && source.includes(".b122-venv-staging-") && resolve(destination) === active) {
        denied = true;
        throw Object.assign(new Error("destination locked"), { code: "EACCES" });
      }
      await rename(source, destination);
    }
  });

  const result = await lifecycle.execute({
    mode: "rebuild",
    confirmed: true,
    operationId: "failed-promotion",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /rolled back/i);
  assert.equal(await readFile(join(active, "old-marker.txt"), "utf8"), "last known good");
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).stagingPaths.length, 1);
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).recoveryPaths.length, 0);
});

test("startup reconciliation restores the sole owned recovery after an interrupted swap", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner, terminalCoordinator: detachedTerminals });
  const operationKey = digest("interrupted-swap");
  const recovery = join(setup.repositoryRoot, `.b122-venv-recovery-${operationKey}`);
  const interpreter = join(recovery, "Scripts", "python.exe");
  await mkdir(dirname(interpreter), { recursive: true });
  await writeFile(interpreter, "test interpreter", "utf8");
  await writeFile(join(recovery, "pyvenv.cfg"), "home = isolated-test", "utf8");
  await writeFile(join(recovery, ".sxsy-b122-venv-state.json"), JSON.stringify({
    schema: "sxsy-b122.python-venv-state",
    version: 1,
    state: "recovery",
    repositoryRoot: await realpath(setup.repositoryRoot),
    operationKey,
    basePythonSha256: python.sha256,
    requirementsSha256: null,
    interpreterSha256: digest("test interpreter"),
    freezeSha256: digest("example==1.2.3\n"),
    createdAt: "2026-08-24T00:00:00.000Z"
  }), "utf8");

  const result = await lifecycle.execute({
    mode: "ensure",
    operationId: "after-crash",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256
  });

  assert.equal(result.status, "completed");
  assert.match(result.reconciliation.join(" "), /restored/i);
  assert.equal(await access(join(setup.repositoryRoot, ".venv", "Scripts", "python.exe")).then(() => true), true);
  assert.equal(await access(recovery).then(() => true).catch(() => false), false);
});

test("dependency inputs must be digest-pinned, hash-complete, concrete, and repository-owned", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  const requirementsPath = join(setup.repositoryRoot, "requirements.lock");
  const wheelhousePath = join(setup.repositoryRoot, "wheelhouse");
  await mkdir(wheelhousePath);
  await writeFile(join(wheelhousePath, "example.whl"), "wheel", "utf8");
  await writeFile(requirementsPath, "example>=1.0\n", "utf8");
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner });

  for (const dependencies of [
    { requirementsPath: "requirements.lock", requirementsSha256: "0".repeat(64), wheelhousePath: "wheelhouse" },
    { requirementsPath: "requirements.lock", requirementsSha256: digest("example>=1.0\n"), wheelhousePath: "wheelhouse" },
    { requirementsPath: join(setup.root, "outside.lock"), requirementsSha256: digest("example>=1.0\n"), wheelhousePath: "wheelhouse" }
  ]) {
    const result = await lifecycle.execute({
      mode: "ensure",
      operationId: `bad-dependencies-${Math.random()}`,
      repositoryRoot: setup.repositoryRoot,
      basePython: python.path,
      basePythonSha256: python.sha256,
      dependencies
    });
    assert.equal(result.status, "blocked");
  }
  assert.equal(runner.calls.length, 0);
});

test("dependency archives are re-attested before the private offline snapshot and source churn fails closed", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  const dependencies = await dependencyLock(setup.repositoryRoot);
  runner.onCreate = async () => {
    await writeFile(join(setup.repositoryRoot, "wheelhouse", "example-1.2.3-py3-none-any.whl"), "changed after admission", "utf8");
  };
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner });

  const result = await lifecycle.execute({
    mode: "ensure",
    operationId: "dependency-churn",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: python.sha256,
    dependencies
  });

  assert.equal(result.status, "blocked");
  assert.match(result.summary, /archive changed/i);
  assert.equal(await access(join(setup.repositoryRoot, ".venv")).then(() => true).catch(() => false), false);
  assert.equal((await lifecycle.inspect(setup.repositoryRoot)).stagingPaths.length, 0);
});

test("base Python identity and canonical repository boundary are verified before mutation", async (context) => {
  const setup = await fixture(context);
  const python = await basePython(setup.root);
  const runner = new FakePythonRunner();
  const lifecycle = new AtomicPythonVenvLifecycle({ processRunner: runner });

  const wrongDigest = await lifecycle.execute({
    mode: "ensure",
    operationId: "wrong-base-python",
    repositoryRoot: setup.repositoryRoot,
    basePython: python.path,
    basePythonSha256: "0".repeat(64)
  });
  assert.equal(wrongDigest.status, "blocked");
  assert.equal(runner.calls.length, 0);

  const alias = join(setup.root, "repository-alias");
  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(setup.repositoryRoot, alias, "junction");
  } catch {
    return context.skip("This host cannot create the test junction.");
  }
  const aliased = await lifecycle.execute({
    mode: "ensure",
    operationId: "aliased-root",
    repositoryRoot: alias,
    basePython: python.path,
    basePythonSha256: python.sha256
  });
  assert.equal(aliased.status, "blocked");
  assert.match(aliased.summary, /canonical|alias|reparse/i);
});

test("the deployment plan cannot use in-place clear and invokes only the dedicated lifecycle entry point", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const template = JSON.parse(await readFile(join(root, "deployment", "windows", "repository-runtime-plan.template.json"), "utf8")) as {
    recipes: Record<string, { executable: string; args: string[] }>;
  };
  for (const [action, mode] of [["venv", "ensure"], ["rebuild_venv", "rebuild"]] as const) {
    assert.doesNotMatch(JSON.stringify(template.recipes[action]), /--clear/);
    assert.equal(template.recipes[action]?.args.some((argument) => argument.endsWith("atomic-python-venv-cli.js")), true);
    assert.deepEqual(template.recipes[action]?.args.slice(-2), ["--mode", mode]);
  }
});
