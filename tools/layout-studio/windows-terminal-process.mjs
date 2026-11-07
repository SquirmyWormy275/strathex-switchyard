/** Exact read-only Windows terminal process evidence. No task or window effect. */
import { randomUUID } from "node:crypto";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { Socket } from "node:net";
import { verifySuiteRelease } from "../../deployment/suite/release.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { desktopEnvironment } from "./process-environment.mjs";

const exact = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === names.slice().sort().join();
const require = v => { if (!v) throw Error("The exact Windows terminal process evidence did not verify."); };
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000";
const decimal = (v, zero = false) => typeof v === "string" && (zero ? /^(?:0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/).test(v) && BigInt(v) <= 0xffffffffffffffffn;
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const windowsLocalExecutablePath = v => typeof v === "string" && /^[A-Za-z]:\\/.test(v) && win32.normalize(v) === v && Buffer.byteLength(v) <= 4096
  && !/[\x00-\x1f\x7f<>:"/|?*]/.test(v.slice(3)) && v.slice(3).split("\\").every(p => p && !/[. ]$/.test(p) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p));

export function windowsTerminalProcessQuery(value) {
  require(exact(value, ["schema", "requestId", "processId", "expectedBirth", "image"]) && value.schema === "switchyard-editor-terminal-process-query/v1" && uuid(value.requestId)
    && Number.isSafeInteger(value.processId) && value.processId > 0 && value.processId <= 0x7fffffff && (value.expectedBirth === null || decimal(value.expectedBirth)));
  const image = value.image;
  require(exact(image, ["path", "sha256", "device", "inode", "size"]) && windowsLocalExecutablePath(image.path) && hash(image.sha256) && decimal(image.device, true) && BigInt(image.device) <= 0xffffffffn
    && decimal(image.inode) && decimal(image.size) && BigInt(image.size) <= 512n * 1024n * 1024n);
  return Object.freeze({ ...value, image: Object.freeze({ ...image }) });
}

export function windowsTerminalProcessResult(value, input) {
  const request = windowsTerminalProcessQuery(input);
  require(exact(value, ["schema", "requestId", "processId", "birth", "image", "currentUserVerified", "currentSessionVerified", "processAccessMask", "tokenAccessMask", "processTerminated", "windowFocused", "taskAttached", "accountVerified"])
    && value.schema === "switchyard-editor-terminal-process-result/v1" && value.requestId === request.requestId && value.processId === request.processId
    && decimal(value.birth) && (request.expectedBirth === null || value.birth === request.expectedBirth)
    && exact(value.image, Object.keys(request.image)) && Object.entries(request.image).every(([k, v]) => value.image[k] === v)
    && value.currentUserVerified === true && value.currentSessionVerified === true && value.processAccessMask === 0x101000 && value.tokenAccessMask === 8
    && ["processTerminated", "windowFocused", "taskAttached", "accountVerified"].every(k => value[k] === false));
  return Object.freeze({ ...value, image: Object.freeze({ ...value.image }) });
}

export function windowsTerminalPeerQuery(value) {
  require(exact(value, ["schema", "requestId", "processId", "expectedBirth", "image", "connection"]) && value.schema === "switchyard-editor-terminal-peer-query/v1");
  const { connection, ...process } = value, checked = windowsTerminalProcessQuery({ ...process, schema: "switchyard-editor-terminal-process-query/v1" });
  require(checked.expectedBirth !== null && exact(connection, ["localAddress", "localPort", "remoteAddress", "remotePort"])
    && connection.localAddress === "127.0.0.1" && connection.remoteAddress === "127.0.0.1"
    && [connection.localPort, connection.remotePort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) && connection.localPort !== connection.remotePort);
  return Object.freeze({ ...value, image: checked.image, connection: Object.freeze({ ...connection }) });
}

export function windowsTerminalPeerResult(value, input) {
  const request = windowsTerminalPeerQuery(input);
  require(value && value.schema === "switchyard-editor-terminal-peer-result/v1" && value.connectionVerified === true);
  const { connection, connectionVerified, ...process } = value;
  require(exact(connection, Object.keys(request.connection)) && Object.entries(request.connection).every(([k, v]) => connection[k] === v));
  const { connection: _, ...selected } = request;
  const checked = windowsTerminalProcessResult({ ...process, schema: "switchyard-editor-terminal-process-result/v1" }, { ...selected, schema: "switchyard-editor-terminal-process-query/v1" });
  return Object.freeze({ ...value, image: checked.image, connection: Object.freeze({ ...connection }) });
}

/** Observe the caller's held accepted socket. This never opens or closes it. */
export async function inspectWindowsTerminalSocket(probe, socket, input, { assertCurrent, signal } = {}) {
  require(socket instanceof Socket && typeof probe?.inspectPeer === "function" && typeof assertCurrent === "function" && signal instanceof AbortSignal);
  require(exact(input, ["processId", "expectedBirth", "image"]));
  const tuple = () => {
    require(!socket.destroyed && !socket.connecting && socket.readyState === "open" && socket.remoteFamily === "IPv4");
    return { localAddress: socket.remoteAddress, localPort: socket.remotePort, remoteAddress: socket.localAddress, remotePort: socket.localPort };
  };
  const selected = windowsTerminalPeerQuery({ schema: "switchyard-editor-terminal-peer-query/v1", requestId: randomUUID(), ...input, connection: tuple() });
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true }); socket.once("close", abort); socket.once("error", abort);
  if (signal.aborted) abort();
  const current = async () => {
    require(!controller.signal.aborted && JSON.stringify(tuple()) === JSON.stringify(selected.connection));
    await assertCurrent();
    require(!controller.signal.aborted && JSON.stringify(tuple()) === JSON.stringify(selected.connection));
  };
  try {
    await current();
    const result = await probe.inspectPeer({ processId: selected.processId, expectedBirth: selected.expectedBirth, image: selected.image, connection: selected.connection }, { assertCurrent: current, signal: controller.signal });
    await current();
    return windowsTerminalPeerResult(result, { ...selected, requestId: result?.requestId });
  } finally { signal.removeEventListener("abort", abort); socket.removeListener("close", abort); socket.removeListener("error", abort); }
}

async function packagedHelper() {
  const root = fileURLToPath(new URL("../../", import.meta.url)), release = await verifySuiteRelease(root, { platform: "win32", checkRuntime: true });
  require(!release.development);
  const image = release.files.find(row => row.path === "runtime/hotkeys/Switchyard.Hotkeys.exe"); require(image);
  return { path: join(root, image.path), sha256: image.sha256 };
}

export function createWindowsTerminalProcessProbe({ platform = process.platform, helper = packagedHelper, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped,
  onOwner = async () => {}, onRetired = async () => {} } = {}) {
  require(typeof onOwner === "function" && typeof onRetired === "function");
  const resource = { clients: new Set(), controller: new AbortController() };
  let pending, closed = false, uncertain = false;
  function inspect(peer, input, { assertCurrent, signal } = {}) {
      require(exact(input, ["processId", "expectedBirth", "image", ...(peer ? ["connection"] : [])]));
      const family = peer ? "peer" : "process", query = peer ? windowsTerminalPeerQuery : windowsTerminalProcessQuery;
      const request = query({ schema: `switchyard-editor-terminal-${family}-query/v1`, requestId: randomUUID(), ...input });
      require(platform === "win32" && !closed && !pending && !uncertain && typeof assertCurrent === "function" && signal instanceof AbortSignal);
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true }); resource.controller.signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || resource.controller.signal.aborted) abort();
      const current = async () => { require(!closed && !controller.signal.aborted); await assertCurrent(); require(!closed && !controller.signal.aborted); };
      // Reserve pending before invoking any caller callback, including a
      // synchronous context check that re-enters this probe.
      const work = Promise.resolve().then(async () => {
        let owner, stopped = false, native, ownership;
        try {
          await current(); native = await helper(); require(native && typeof native.path === "string" && hash(native.sha256)); await current();
          const observeExit = frame => guardianStopped(frame, { windowsHelper: native.path });
          const result = await runOwnedNativeCommand({ executable: native.path, args: [`--editor-terminal-${family}-v1`], cwd: dirname(native.path), env: desktopEnvironment(),
            text: JSON.stringify(request) + "\n", timeout: 10000, maxOutputBytes: 16384, captureStderrBytes: 0, expectedExecutableSha256: native.sha256,
            resource, signal: controller.signal, command: (exe, args, options) => command(exe, args, { ...options, windowsHelper: native.path }), guardianStopped: observeExit,
            onReady: async scope => {
              require(scope.containment === "windows-job"); owner = scope;
              ownership = { schema: "switchyard-windows-query-owner/v1", requestId: request.requestId, role: family, scope: { ...scope }, helper: { path: native.path, sha256: native.sha256 } };
              await onOwner(structuredClone(ownership)); await current();
            },
            onStopped: async scope => { require(await observeExit(scope)); require(ownership); await onRetired(structuredClone(ownership)); stopped = true; }
          });
          await current(); require(owner && stopped && result.status === "completed" && result.exitCode === 0);
          return (peer ? windowsTerminalPeerResult : windowsTerminalProcessResult)(JSON.parse(result.stdout), request);
        } finally {
          signal.removeEventListener("abort", abort); resource.controller.signal.removeEventListener("abort", abort);
          const exits = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
          uncertain = exits.some(value => !value) || !!owner && !stopped;
          if (!uncertain) resource.clients.clear();
        }
      });
      pending = work;
      void work.then(() => { pending = undefined; }, () => { pending = undefined; });
      return work;
  }
  return Object.freeze({
    inspect: (input, context) => inspect(false, input, context),
    inspectPeer: (input, context) => inspect(true, input, context),
    async close() {
      closed = true; resource.controller.abort(); await pending?.catch(() => {});
      const exits = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
      require(exits.every(Boolean)); resource.clients.clear(); return { stoppedVerified: true, targetProcessTerminated: false };
    }
  });
}
