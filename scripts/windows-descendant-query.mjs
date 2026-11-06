/** Disposable CI only: register exact native descendants with the original owner. */
import { closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { runRuntimeCommand, runtimeGuardianStopped } from "../tools/layout-studio/runtime-command.mjs";

const schema = "switchyard-descendant-query/v1";
const require = value => { if (!value) throw Error("The exact CI descendant QUERY registration did not verify."); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const birth = value => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value);
export function descendantQueryRequest(value) {
  require(object(value) && Object.keys(value).sort().join() === "birth,executableSha256,nonce,pid,role,schema,sequence");
  require(value.schema === schema && typeof value.nonce === "string" && /^[a-f0-9]{32}$/.test(value.nonce)
    && Number.isInteger(value.sequence) && value.sequence >= 1 && value.sequence <= 64
    && ["guardian", "worker", "status"].includes(value.role) && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 0xffffffff
    && hash(value.executableSha256) && (value.role === "worker" ? birth(value.birth) : value.birth === null));
  return { ...value };
}
export function descendantQueryReply(value, request) {
  descendantQueryRequest(request);
  require(object(value) && Object.keys(value).sort().join() === "birth,executableSha256,grantedMask,nonce,pid,role,schema,sequence,status");
  require(["schema", "nonce", "sequence", "role", "pid", "executableSha256"].every(key => value[key] === request[key])
    && value.status === "verified" && value.grantedMask === 8 && birth(value.birth) && (request.birth === null || value.birth === request.birth));
  return { ...value };
}

export function createWindowsDescendantQuery(context, contextPath) {
  require(process.platform === "win32" && process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_OS === "Windows"
    && contextPath === process.env.SWITCHYARD_TEST_RESTRICTED_HOST_CONTEXT && hash(context.serviceImageSha256));
  const root = dirname(contextPath), original = lstatSync(root, { bigint: true }), sleeper = new Int32Array(new SharedArrayBuffer(4));
  require(original.isDirectory() && !original.isSymbolicLink()); let sequence = 0, failed = false;
  const assertRoot = () => { const current = lstatSync(root, { bigint: true }); require(current.isDirectory() && !current.isSymbolicLink() && current.dev === original.dev && current.ino === original.ino); };
  function register(role, pid, workerBirth, executableSha256) {
    require(!failed); const request = descendantQueryRequest({ schema, nonce: context.nonce, sequence: ++sequence, role, pid, birth: workerBirth, executableSha256 });
    const base = join(root, `descendant-${sequence}`), pending = base + ".pending", input = base + ".request", output = base + ".reply";
    try {
      assertRoot(); require(!existsSync(input) && !existsSync(output));
      const fd = openSync(pending, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify(request)); fsyncSync(fd); } finally { closeSync(fd); }
      // Publish without replacement. Keep the owned pending link until outer
      // fixture retirement: the native reader's share lock can deny unlink.
      linkSync(pending, input);
      const deadline = performance.now() + 5000;
      while (!existsSync(output) && performance.now() < deadline) Atomics.wait(sleeper, 0, 0, 10);
      assertRoot(); const named = lstatSync(output, { bigint: true }); require(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size > 1n && named.size <= 2048n);
      const replyFd = openSync(output, "r");
      try {
        const opened = fstatSync(replyFd, { bigint: true }); require(opened.dev === named.dev && opened.ino === named.ino && opened.size === named.size && opened.nlink === 1n);
        const bytes = readFileSync(replyFd); require(BigInt(bytes.length) === named.size);
        return descendantQueryReply(JSON.parse(bytes.toString("utf8")), request);
      } finally { closeSync(replyFd); }
    } catch { failed = true; throw Error("The exact CI descendant QUERY registration did not verify."); }
  }
  const guardian = role => child => { require(child.exitCode === null && child.signalCode === null); register(role, child.pid, null, context.serviceImageSha256); };
  return {
    command: (executable, args, options) => runRuntimeCommand(executable, args, { ...options,
      onGuardianChild: child => { guardian("guardian")(child); options.onGuardianChild?.(child); },
      onWorkerSuspended: frame => { register("worker", frame.workerPid, frame.workerBirth, frame.executableSha256); },
    }),
    guardianStopped: frame => runtimeGuardianStopped(frame, { windowsHelper: context.helper, onGuardianChild: guardian("status") }),
  };
}
