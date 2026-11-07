/** Stable loader contents and native desktop entry generation. */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { privateDirectory } from "../../tools/layout-studio/private-fs.mjs";
import { prepareWindowsShortcut } from "./shortcut-process.mjs";
const shellQuote = (s) => `'${s.replaceAll("'", `'"'"'`)}'`;
const desktopQuote = (s) => `"${s.replaceAll("%", "%%").replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
export const stableLoader = Buffer.from(`// Switchyard installed entry. Managed by the verified suite installer.
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url)).replace(/[\\\\/]$/, '');
async function plain(path){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>128*1024*1024)throw Error('Unsafe installation file.');return readFile(path);}
const hash=b=>createHash('sha256').update(b).digest('hex');
let pending;try{pending=JSON.parse((await plain(join(root,'pending.json'))).toString('utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(pending&&process.argv[2]!=='recover')throw Error('A Switchyard installation transaction needs recovery before launch. Run switchyard recover.');
const state=pending?{schema:'switchyard-installation/v1',current:pending.recoveryVersion,runtime:pending.runtime}:JSON.parse((await plain(join(root,'installed.json'))).toString('utf8'));
if(state.schema!=='switchyard-installation/v1'||!/^[a-f0-9]{64}$/.test(state.current)||state.runtime?.version!==process.versions.node||state.runtime.path!==await realpath(process.execPath)||hash(await plain(process.execPath))!==state.runtime.sha256)throw Error('The installed application/runtime identity did not verify.');
const bundle=join(root,'versions',state.current),manifest=JSON.parse((await plain(join(bundle,'switchyard-release.json'))).toString('utf8'));
const {id,...identity}=manifest;if(id!==state.current||hash(JSON.stringify(identity))!==id)throw Error('The installed release identity did not verify.');
const checker=join(bundle,'deployment/suite/release.mjs'),entry=manifest.files.find(f=>f.path==='deployment/suite/release.mjs');
if(!entry||hash(await plain(checker))!==entry.sha256)throw Error('The installed verifier changed.');
const {verifySuiteRelease}=await import(pathToFileURL(checker));await verifySuiteRelease(bundle,{expectedId:state.current,platform:process.platform,checkRuntime:true});
if(pending){const {runInstallationCli}=await import(pathToFileURL(join(bundle,'deployment/suite/manage.mjs')));await runInstallationCli(['recover'],{root});}
else {const {runApplicationCli}=await import(pathToFileURL(join(bundle,'deployment/suite/cli.mjs')));await runApplicationCli(process.argv.slice(2),bundle,{installationRoot:root});}
`);
/** Dated recovery entry remains callable if an interrupted uninstall removed the main command. */
export function recoveryLoader(root) {
  if (typeof root !== "string" || /[\0\r\n]/.test(root)) throw new Error("Unsupported recovery installation path.");
  const source = stableLoader.toString("utf8"), pattern = /^const root=.*;$/m;
  if (!pattern.test(source)) throw new Error("The stable recovery loader root could not be verified.");
  return Buffer.from(source.replace(pattern, () => `const root=${JSON.stringify(root)};`));
}
export async function launcherContents({ root, nodePath, platform = process.platform, stateRoot }) {
  if ([root, nodePath, stateRoot].some((s) => typeof s !== "string" || /[\0\r\n]/.test(s))) throw new Error("Unsupported installation path.");
  const loader = join(root, "launch.mjs");
  if (platform === "linux") return {
    command: { bytes: Buffer.from(`#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(loader)} "$@"\n`), mode: 0o755 },
    desktop: { bytes: Buffer.from(`[Desktop Entry]\nType=Application\nName=Switchyard\nComment=Return to the same task with your keyboard\nExec=${desktopQuote(nodePath)} ${desktopQuote(loader)} launch\nIcon=input-keyboard\nTerminal=false\nStartupNotify=false\nCategories=Utility;\n`), mode: 0o644 }
  };
  if (platform !== "win32" || /[%!^&<>|]/.test(nodePath + loader)) throw new Error("Unsupported native launcher path; existing launchers were preserved.");
  await privateDirectory(join(stateRoot, "shortcut-staging"));
  const path = join(stateRoot, "shortcut-staging", `${randomUUID()}.lnk`);
  const bytes = await prepareWindowsShortcut({ path, nodePath, loader, directory: root });
  return { command: { bytes: Buffer.from(`@echo off\r\n"${nodePath}" "${loader}" %*\r\n`), mode: 0o700 }, desktop: { bytes, mode: 0o600 } };
}
