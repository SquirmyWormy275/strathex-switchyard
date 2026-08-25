/** Strict host-owned provider path configuration loaded only during companion bootstrap. */
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { providerIds, type FixedProviderDesktopPaths, type ProviderId } from "./provider-desktop.ts";

const maximumBytes = 64 * 1024;

export async function loadProviderDesktopPaths(filePath: string): Promise<FixedProviderDesktopPaths | undefined> {
  const expected = resolve(filePath);
  let link;
  try { link = await lstat(expected); }
  catch (error) { if (missing(error)) return undefined; throw error; }
  if (!link.isFile() || link.isSymbolicLink() || link.size <= 0 || link.size > maximumBytes) throw new Error("The provider desktop path configuration is absent, linked, empty, or oversized.");
  const canonical = await realpath(expected);
  const bytes = await readFile(canonical);
  if (bytes.byteLength !== link.size) throw new Error("The provider desktop path configuration changed while being read.");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("The provider desktop path configuration is not valid JSON."); }
  if (!record(value) || !exact(value, ["schema", "version", "providers"]) || value.schema !== "sxsy-b122.provider-desktop-paths" || value.version !== 2 || !record(value.providers)) throw new Error("The provider desktop path configuration schema is invalid.");
  const keys = Object.keys(value.providers);
  if (keys.length < 1 || keys.length > providerIds.length || keys.some((key) => !(providerIds as readonly string[]).includes(key))) throw new Error("The provider desktop path configuration contains an unknown or empty provider set.");
  const result: Partial<Record<ProviderId, { path: string; signerSubject: string; signerThumbprint: string }>> = {};
  for (const provider of keys as ProviderId[]) {
    const configured = value.providers[provider];
    if (!record(configured) || !exact(configured, ["path", "signerSubject", "signerThumbprint"])
      || typeof configured.path !== "string" || !localExecutablePath(configured.path)
      || typeof configured.signerSubject !== "string" || configured.signerSubject.length < 3 || configured.signerSubject.length > 512 || /[\0\r\n]/.test(configured.signerSubject)
      || typeof configured.signerThumbprint !== "string" || !/^[a-fA-F0-9]{40,128}$/.test(configured.signerThumbprint)) throw new Error(`The fixed ${provider} executable trust record is invalid.`);
    result[provider] = { path: resolve(configured.path), signerSubject: configured.signerSubject, signerThumbprint: configured.signerThumbprint.toLowerCase() };
  }
  return result;
}

function localExecutablePath(value: string): boolean {
  if (value.length < 4 || value.length > 160 || /[\0\r\n]/.test(value) || !isAbsolute(value) || !/\.exe$/i.test(value)) return false;
  if (/^(?:\\\\|\/\/|\\\\\?\\|\\\\\.\\)/.test(value)) return false;
  return process.platform === "win32" ? /^[A-Za-z]:[\\/]/.test(value) : value.startsWith("/");
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => key in value); }
function missing(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT"; }
