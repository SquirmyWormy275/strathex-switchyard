/** Exact read-only Windows terminal process evidence. No task or window effect. */
import { randomUUID } from "node:crypto";
import { dirname, join, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySuiteRelease } from "../../deployment/suite/release.mjs";
import { runOwnedNativeCommand } from "./owned-native-command.mjs";
import { runRuntimeCommand, runtimeGuardianStopped } from "./runtime-command.mjs";
import { desktopEnvironment } from "./process-environment.mjs";

const exact = (v, names) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === names.slice().sort().join();
const require = v => { if (!v) throw Error("The exact Windows terminal process evidence did not verify."); };
const uuid = v => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000";
const decimal = (v, zero = false) => typeof v === "string" && (zero ? /^(?:0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/).test(v) && BigInt(v) <= 0xffffffffffffffffn;
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const path = v => typeof v === "string" && /^[A-Za-z]:\\/.test(v) && win32.normalize(v) === v && Buffer.byteLength(v) <= 4096
  && !/[\x00-\x1f\x7f<>:"/|?*]/.test(v.slice(3)) && v.slice(3).split("\\").every(p => p && !/[. ]$/.test(p) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p));

export function windowsTerminalProcessQuery(value) {
  require(exact(value, ["schema", "requestId", "processId", "expectedBirth", "image"]) && value.schema === "switchyard-editor-terminal-process-query/v1" && uuid(value.requestId)
    && Number.isSafeInteger(value.processId) && value.processId > 0 && value.processId <= 0x7fffffff && (value.expectedBirth === null || decimal(value.expectedBirth)));
  const image = value.image;
  require(exact(image, ["path", "sha256", "device", "inode", "size"]) && path(image.path) && hash(image.sha256) && decimal(image.device, true) && BigInt(image.device) <= 0xffffffffn
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

async function packagedHelper() {
  const root = fileURLToPath(new URL("../../", import.meta.url)), release = await verifySuiteRelease(root, { platform: "win32", checkRuntime: true });
  require(!release.development);
  const image = release.files.find(row => row.path === "runtime/hotkeys/Switchyard.Hotkeys.exe"); require(image);
  return { path: join(root, image.path), sha256: image.sha256 };
}

export function createWindowsTerminalProcessProbe({ platform = process.platform, helper = packagedHelper, command = runRuntimeCommand, guardianStopped = runtimeGuardianStopped } = {}) {
  const resource = { clients: new Set(), controller: new AbortController() };
  let pending, closed = false, uncertain = false;
  return Object.freeze({
    inspect(input, { assertCurrent, signal } = {}) {
      require(exact(input, ["processId", "expectedBirth", "image"]));
      const request = windowsTerminalProcessQuery({ schema: "switchyard-editor-terminal-process-query/v1", requestId: randomUUID(), ...input });
      require(platform === "win32" && !closed && !pending && !uncertain && typeof assertCurrent === "function" && signal instanceof AbortSignal);
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true }); resource.controller.signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted || resource.controller.signal.aborted) abort();
      const current = async () => { require(!closed && !controller.signal.aborted); await assertCurrent(); require(!closed && !controller.signal.aborted); };
      const work = (async () => {
        let owner, stopped = false, native;
        try {
          await current(); native = await helper(); require(native && typeof native.path === "string" && hash(native.sha256)); await current();
          const observeExit = frame => guardianStopped(frame, { windowsHelper: native.path });
          const result = await runOwnedNativeCommand({ executable: native.path, args: ["--editor-terminal-process-v1"], cwd: dirname(native.path), env: desktopEnvironment(),
            text: JSON.stringify(request) + "\n", timeout: 10000, maxOutputBytes: 16384, captureStderrBytes: 0, expectedExecutableSha256: native.sha256,
            resource, signal: controller.signal, command: (exe, args, options) => command(exe, args, { ...options, windowsHelper: native.path }), guardianStopped: observeExit,
            onReady: async scope => { require(scope.containment === "windows-job"); owner = scope; await current(); },
            onStopped: async scope => { require(await observeExit(scope)); stopped = true; }
          });
          await current(); require(owner && stopped && result.status === "completed" && result.exitCode === 0);
          return windowsTerminalProcessResult(JSON.parse(result.stdout), request);
        } finally {
          signal.removeEventListener("abort", abort); resource.controller.signal.removeEventListener("abort", abort);
          const exits = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
          uncertain = exits.some(value => !value) || !!owner && !stopped;
          if (!uncertain) resource.clients.clear();
        }
      })();
      pending = work;
      void work.then(() => { pending = undefined; }, () => { pending = undefined; });
      return work;
    },
    async close() {
      closed = true; resource.controller.abort(); await pending?.catch(() => {});
      const exits = await Promise.all([...resource.clients].map(client => client.stop().catch(() => false)));
      require(exits.every(Boolean)); resource.clients.clear(); return { stoppedVerified: true, targetProcessTerminated: false };
    }
  });
}
