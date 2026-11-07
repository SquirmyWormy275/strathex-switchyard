import { posix } from "node:path";

/** Linux App Server attachment: one UUID, exact local endpoint/root, no prompt. */
export function codexTerminalConnectionArguments(repositoryRoot: string, socketPath: string): readonly string[] {
  if (typeof repositoryRoot !== "string" || !posix.isAbsolute(repositoryRoot) || posix.normalize(repositoryRoot) !== repositoryRoot || Buffer.byteLength(repositoryRoot) > 4096 || /[\\\x00-\x1f\x7f]/.test(repositoryRoot)) throw new Error("The exact Codex terminal repository path is invalid.");
  if (typeof socketPath !== "string" || !posix.isAbsolute(socketPath) || posix.normalize(socketPath) !== socketPath || Buffer.byteLength(socketPath) > 103 || /[\\\x00-\x20\x7f#?%]/.test(socketPath)) throw new Error("The exact local Codex socket cannot be represented unambiguously within its Unix address bound.");
  return Object.freeze(["--remote", "unix://" + socketPath, "--sandbox", "read-only", "--ask-for-approval", "on-request", "--cd", repositoryRoot]);
}

export function codexTerminalResumeArguments(threadId: string, repositoryRoot: string, socketPath: string): readonly string[] {
  if (typeof threadId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(threadId)) throw new Error("Exact Codex terminal attachment requires the returned session UUID; names and recent-session selectors are refused.");
  return Object.freeze(["resume", ...codexTerminalConnectionArguments(repositoryRoot, socketPath), threadId]);
}
