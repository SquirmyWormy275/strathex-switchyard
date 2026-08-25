import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const firmwareRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(firmwareRoot, "..");
const requiredCompiler = process.argv.includes("--require-c-compiler");
const receiptArgument = process.argv.indexOf("--receipt");
const receiptPath = receiptArgument >= 0 ? process.argv[receiptArgument + 1] : undefined;
const compilerArgument = process.argv.indexOf("--c-compiler");
const explicitCompiler = compilerArgument >= 0 ? process.argv[compilerArgument + 1] : undefined;
if (receiptArgument >= 0 && (!receiptPath || receiptPath.startsWith("--"))) throw new Error("--receipt requires one output path.");
if (compilerArgument >= 0 && (!explicitCompiler || explicitCompiler.startsWith("--"))) throw new Error("--c-compiler requires one exact executable path.");
const checks = [
  ["manifest generation", process.execPath, ["packages/protocol/scripts/generate-manifest.mjs"]],
  ["TypeScript protocol simulator", process.execPath, ["--experimental-transform-types", "--test", "packages/protocol/test/b122.test.ts", "packages/protocol/test/raw-hid.test.ts", "apps/windows-companion/test/raw-hid-protocol.test.ts"]],
];
for (const [label, command, args] of checks) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error(`${label} failed\n${result.stdout}\n${result.stderr}`);
  process.stdout.write(`${label}: passed\n`);
}

const manifest = JSON.parse(readFileSync(join(root, "packages/protocol/generated/b122-control-map.json"), "utf8"));
if (manifest.controls.length !== 22 || manifest.assignments.length !== 65) throw new Error("Generated manifest count mismatch.");
const vial = JSON.parse(readFileSync(join(firmwareRoot, "vial/logical-b122-vial.json"), "utf8"));
const coordinates = vial.layouts.keymap.flat();
if (coordinates.length !== 22 || new Set(coordinates).size !== 22) throw new Error("Logical Vial definition must contain 22 unique controls.");
const qmkSource = readFileSync(join(firmwareRoot, "qmk/keymaps/b122/keymap.c"), "utf8");
for (const forbidden of ["system(", "ShellExecute", "CreateProcess", "WinExec", "powershell", "http://", "https://", "git "]) {
  if (qmkSource.includes(forbidden)) throw new Error(`Signal-only QMK source contains forbidden host-action marker: ${forbidden}`);
}
process.stdout.write("QMK/Vial static signal-only checks: passed\n");

const helperSource = readFileSync(join(firmwareRoot, "windows-hid-helper/Program.cs"), "utf8");
for (const required of ["SetupDiEnumDeviceInterfaces", "HidP_GetCaps", "VendorId", "ProductId", "UsagePage", "InputReportByteLength", "OutputReportByteLength"]) {
  if (!helperSource.includes(required)) throw new Error(`Windows Raw HID helper lacks required native boundary: ${required}`);
}
process.stdout.write("Windows SetupAPI/HID helper static checks: passed\n");

const dotnetArgument = process.argv.indexOf("--dotnet");
const dotnetPath = dotnetArgument >= 0 ? process.argv[dotnetArgument + 1] : (process.env.B122_DOTNET_PATH || join(root, ".tools", "dotnet", "dotnet.exe"));
const dotnet = dotnetPath && existsSync(dotnetPath) ? spawnSync(dotnetPath, ["--list-sdks"], { encoding: "utf8" }) : undefined;
if (dotnet?.status === 0 && dotnet.stdout.trim()) {
  const sdk = dotnet.stdout.trim().split(/\r?\n/).at(-1).match(/^([^ ]+) \[(.+)]$/);
  if (!sdk) throw new Error("Pinned .NET SDK inventory was malformed.");
  const csc = join(sdk[2], sdk[1], "Roslyn", "bincore", "csc.dll");
  const runtime = join(resolve(dotnetPath, ".."), "packs", "Microsoft.NETCore.App.Ref", "8.0.30", "ref", "net8.0");
  const compileRoot = mkdtempSync(join(tmpdir(), "b122-csharp-"));
  try {
    const references = readdirSync(runtime).filter((file) => file.endsWith(".dll")).map((file) => `/reference:"${join(runtime, file)}"`);
    const responseFile = join(compileRoot, "compile.rsp");
    writeFileSync(responseFile, ["/noconfig", "/nostdlib+", "/langversion:latest", "/nullable:enable", "/target:exe", `/out:"${join(compileRoot, "strathex-b122-hid-helper.dll")}"`, ...references, `"${join(root, "firmware/windows-hid-helper/Program.cs")}"`].join("\n"));
    const build = spawnSync(dotnetPath, [csc, `@${responseFile}`], { cwd: root, encoding: "utf8" });
    if (build.status !== 0) throw new Error(`Windows Raw HID helper compile failed\n${build.stdout ?? ""}\n${build.stderr ?? build.error?.message ?? ""}`);
    process.stdout.write("Windows Raw HID helper compile through pinned .NET SDK: passed\n");
  } finally { rmSync(compileRoot, { recursive: true, force: true }); }
} else {
  const pwsh = join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
  const compiler = existsSync(pwsh) ? pwsh : "pwsh";
  const compile = spawnSync(compiler, ["-NoProfile", "-File", "firmware/verify-windows-helper.ps1"], { cwd: root, encoding: "utf8" });
  if (!compile.error || compile.error.code !== "ENOENT") {
    if (compile.status !== 0) throw new Error(`Windows Raw HID helper C# compile failed\n${compile.stdout}\n${compile.stderr}`);
    process.stdout.write("Windows Raw HID helper C# compile: passed\n");
  } else process.stdout.write(".NET SDK/PowerShell compiler unavailable; Windows helper source/static boundary checks passed.\n");
}

const ambientCompilerCandidates = process.platform === "win32"
  ? [["clang", ["-std=c11", "-Wall", "-Wextra", "-Werror"]], ["gcc", ["-std=c11", "-Wall", "-Wextra", "-Werror"]]]
  : [["cc", ["-std=c11", "-Wall", "-Wextra", "-Werror"]], ["clang", ["-std=c11", "-Wall", "-Wextra", "-Werror"]], ["gcc", ["-std=c11", "-Wall", "-Wextra", "-Werror"]]];
const compilerCandidates = explicitCompiler
  ? [[resolve(explicitCompiler), ["-std=c11", "-Wall", "-Wextra", "-Werror"]]]
  : ambientCompilerCandidates;
let compiled = false;
let compilerEvidence;
const temporary = mkdtempSync(join(tmpdir(), "b122-firmware-"));
try {
  if (process.platform === "win32" && !explicitCompiler) {
    const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
    if (existsSync(vswhere)) {
      const found = spawnSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" });
      const installation = found.status === 0 ? found.stdout.trim() : "";
      const vcvars = installation ? join(installation, "VC", "Auxiliary", "Build", "vcvars64.bat") : "";
      if (vcvars && existsSync(vcvars)) {
        const executable = join(temporary, "b122-selftest.exe");
        const commandFile = join(temporary, "compile-b122.cmd");
        const versionFile = join(temporary, "compiler-version.txt");
        writeFileSync(commandFile, `@call "${vcvars}" >nul\r\n@if errorlevel 1 exit /b %errorlevel%\r\n@cl /nologo /Bv > "${versionFile}" 2>&1\r\n@cl /nologo /std:c11 /W4 /WX /Fe:"${executable}" "${join(root, "firmware/protocol/b122_protocol.c")}" "${join(root, "firmware/simulator/protocol_selftest.c")}"\r\n`);
        const build = spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), ["/d", "/c", commandFile], { cwd: temporary, encoding: "utf8" });
        if (build.status !== 0) throw new Error(`C protocol build failed with MSVC\n${build.stdout}\n${build.stderr}`);
        const run = spawnSync(executable, [], { encoding: "utf8" });
        if (run.status !== 0) throw new Error(`C protocol self-test failed\n${run.stdout}\n${run.stderr}`);
        process.stdout.write("C11 protocol compile/self-test (MSVC Build Tools): passed\n");
        compiled = true;
        const versionOutput = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "MSVC Build Tools";
        compilerEvidence = compilerFingerprint("msvc", ["/std:c11", "/W4", "/WX"], versionOutput);
      }
    }
  }
  for (const [compiler, flags] of compiled ? [] : compilerCandidates) {
    const probe = spawnSync(compiler, ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) continue;
    const executable = join(temporary, process.platform === "win32" ? "b122-selftest.exe" : "b122-selftest");
    const build = spawnSync(compiler, [...flags, "firmware/protocol/b122_protocol.c", "firmware/simulator/protocol_selftest.c", "-o", executable], { cwd: root, encoding: "utf8" });
    if (build.status !== 0) throw new Error(`C protocol build failed with ${compiler}\n${build.stdout}\n${build.stderr}`);
    const run = spawnSync(executable, [], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`C protocol self-test failed\n${run.stdout}\n${run.stderr}`);
    process.stdout.write(`C11 protocol compile/self-test (${compiler}): passed\n`);
    compiled = true;
    compilerEvidence = compilerFingerprint(basename(compiler), flags, `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`.trim());
    break;
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const verificationReceipt = {
  schema: "sxsy-b122.firmware-verification",
  version: 1,
  status: compiled ? "passed" : "static-only",
  compilerRequired: requiredCompiler,
  compiled,
  protocolSelfTest: compiled,
  compiler: compilerEvidence ?? null,
  hardwareAccessed: false,
};
if (receiptPath) writeJsonAtomic(resolve(receiptPath), verificationReceipt);
if (!compiled) {
  if (requiredCompiler) throw new Error("Evidence-eligible firmware verification requires a working C11 compiler and portable protocol self-test.");
  process.stdout.write("C compiler unavailable; deterministic manifest, TypeScript framing, and QMK/Vial static checks passed.\n");
}

function compilerFingerprint(kind, flags, versionOutput) {
  const normalized = versionOutput.replaceAll("\r\n", "\n").trim();
  return {
    kind,
    flags,
    versionOutputSha256: createHash("sha256").update(normalized, "utf8").digest("hex"),
    fingerprintSha256: createHash("sha256").update(JSON.stringify({ kind, flags, normalized }), "utf8").digest("hex"),
  };
}

function writeJsonAtomic(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
