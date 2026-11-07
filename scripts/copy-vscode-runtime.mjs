import { copyFile, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageWindowsEditorRuntime } from "./vscode-windows-runtime.mjs";

export async function copyVscodeRuntime({root,dist=resolve(root,"apps/vscode-extension/dist"),platform=process.platform}) {
  const target=resolve(dist,"apps/vscode-extension/src");await mkdir(target,{recursive:true});
  if(await realpath(root)!==root || await realpath(target)!==target)throw Error("The extension runtime copy path is redirected.");
  for(const name of ["codex-daemon-status.cjs","windows-editor-runtime.cjs"])
    await copyFile(resolve(root,"apps/vscode-extension/src",name),resolve(target,name),constants.COPYFILE_EXCL);
  return packageWindowsEditorRuntime({sourceRoot:root,outputRoot:resolve(dist,"windows-editor-runtime"),platform});
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await copyVscodeRuntime({root:await realpath(resolve(dirname(fileURLToPath(import.meta.url)),".."))});
