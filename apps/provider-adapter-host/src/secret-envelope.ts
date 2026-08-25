import { readFile } from "node:fs/promises";

import type { UserSecretProtector } from "../../windows-companion/src/windows-secret.ts";

const maximumEnvelopeBytes = 64 * 1024;
const maximumOpenedBytes = 8 * 1024;

export interface ProviderHostSecretEnvelope {
  readonly schema: "sxsy-b122.provider-host-secret-envelope";
  readonly version: 1;
  readonly protector: string;
  readonly sealed: string;
}

export async function openProviderHostSecretEnvelope(filePath: string, protector: UserSecretProtector): Promise<Uint8Array> {
  const bytes = await readFile(filePath);
  if (bytes.byteLength < 1 || bytes.byteLength > maximumEnvelopeBytes) { bytes.fill(0); throw new Error("The provider-host secret envelope is empty or oversized."); }
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } finally { bytes.fill(0); }
  if (!isEnvelope(parsed) || parsed.protector !== protector.provider) throw new Error("The provider-host secret envelope is malformed or belongs to another protector.");
  const cleartext = new Uint8Array(await protector.open(parsed.sealed));
  if (cleartext.byteLength < 1 || cleartext.byteLength > maximumOpenedBytes || Buffer.from(cleartext).includes(0)) { cleartext.fill(0); throw new Error("The provider-host protected secret is empty, oversized, or malformed."); }
  return cleartext;
}

function isEnvelope(value: unknown): value is ProviderHostSecretEnvelope {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 4
    && (value as ProviderHostSecretEnvelope).schema === "sxsy-b122.provider-host-secret-envelope"
    && (value as ProviderHostSecretEnvelope).version === 1
    && typeof (value as ProviderHostSecretEnvelope).protector === "string"
    && /^[A-Za-z0-9._-]{1,80}$/.test((value as ProviderHostSecretEnvelope).protector)
    && typeof (value as ProviderHostSecretEnvelope).sealed === "string"
    && /^[A-Za-z0-9+/]+={0,2}$/.test((value as ProviderHostSecretEnvelope).sealed)
    && (value as ProviderHostSecretEnvelope).sealed.length <= 32 * 1024;
}
