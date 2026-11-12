import { directoryIdentity } from "./private-fs.mjs";
export async function repositoryIdentity(root) {
  const stat = await directoryIdentity(root);
  if (stat.ino <= 0n || stat.dev < 0n) throw new Error("The selected repository has no verified native directory identity.");
  return { device: stat.dev.toString(), inode: stat.ino.toString() };
}
export async function verifyRepositoryIdentity(task) {
  const current = await repositoryIdentity(task.repositoryRoot);
  if (task.repositoryIdentity && (current.device !== task.repositoryIdentity.device || current.inode !== task.repositoryIdentity.inode)) throw new Error("The original repository directory was replaced. Its saved task was preserved and no operation was redirected.");
  return current;
}
