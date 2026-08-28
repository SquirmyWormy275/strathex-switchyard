import { posix, win32 } from "node:path";

/** Platform-aware absolute repository identity without Windows case folding on Linux. */
export function exactHostAbsoluteRoot(value: unknown, platform: NodeJS.Platform = process.platform): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096 || /[\0\r\n]/.test(value)) return false;
  if (platform === "win32") return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && win32.isAbsolute(value)
    && win32.normalize(value).replaceAll("\\", "/") === value.replaceAll("\\", "/");
  if (platform === "linux") return value.startsWith("/") && !value.startsWith("//") && posix.isAbsolute(value) && posix.normalize(value) === value;
  return false;
}

export function hostRootKey(value: string, platform: NodeJS.Platform = process.platform): string {
  if (!exactHostAbsoluteRoot(value, platform)) return "";
  if (platform === "win32") return value.replaceAll("\\", "/").replace(/^\/\/?\?\//, "").replace(/\/+$/, "").toLowerCase();
  return value === "/" ? value : value.replace(/\/+$/, "");
}

/** Canonical absolute identity carried in durable cross-host protocol records. */
export function exactPortableAbsoluteRoot(value: unknown): value is string {
  return exactHostAbsoluteRoot(value, "win32") || exactHostAbsoluteRoot(value, "linux");
}

export function portableRootKey(value: string): string {
  if (exactHostAbsoluteRoot(value, "win32")) return `win32:${hostRootKey(value, "win32")}`;
  if (exactHostAbsoluteRoot(value, "linux")) return `linux:${hostRootKey(value, "linux")}`;
  return "";
}
