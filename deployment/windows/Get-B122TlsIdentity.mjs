#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, timingSafeEqual, X509Certificate } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const maximumCertificateBytes = 2 * 1024 * 1024;

export async function readTlsIdentity(path, privateKeyPath) {
  if (typeof path !== "string" || !isAbsolute(path) || /[\0\r\n]/.test(path)) throw new Error("The TLS certificate path must be absolute.");
  const exactPath = resolve(path);
  const metadata = await stat(exactPath);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumCertificateBytes) throw new Error("The TLS certificate is missing or oversized.");
  const pem = await readFile(exactPath);
  const certificate = new X509Certificate(pem);
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  const validFromMs = Date.parse(certificate.validFrom);
  const validToMs = Date.parse(certificate.validTo);
  const now = Date.now();
  const serverAuthentication = certificate.keyUsage?.includes("1.3.6.1.5.5.7.3.1") === true;
  const loopbackIdentity = certificate.checkIP("127.0.0.1") === "127.0.0.1";
  let privateKeyMatches = undefined;
  let privateKeyFileSha256 = undefined;
  if (privateKeyPath !== undefined) {
    if (typeof privateKeyPath !== "string" || !isAbsolute(privateKeyPath) || /[\0\r\n]/.test(privateKeyPath)) throw new Error("The TLS private-key path must be absolute.");
    const exactPrivateKeyPath = resolve(privateKeyPath);
    const keyMetadata = await stat(exactPrivateKeyPath);
    if (!keyMetadata.isFile() || keyMetadata.size < 1 || keyMetadata.size > maximumCertificateBytes) throw new Error("The TLS private key is missing or oversized.");
    const keyBytes = await readFile(exactPrivateKeyPath);
    try {
      const keySpki = createPublicKey(createPrivateKey(keyBytes)).export({ type: "spki", format: "der" });
      privateKeyMatches = keySpki.byteLength === spki.byteLength && timingSafeEqual(Buffer.from(keySpki), Buffer.from(spki));
      privateKeyFileSha256 = createHash("sha256").update(keyBytes).digest("hex");
    } finally { keyBytes.fill(0); }
  }
  return {
    schema: "sxsy-b122.tls-identity",
    version: 1,
    certificateFileSha256: createHash("sha256").update(pem).digest("hex"),
    certificateDerSha256: createHash("sha256").update(certificate.raw).digest("hex"),
    tlsSpkiSha256: createHash("sha256").update(spki).digest("hex"),
    ...(privateKeyFileSha256 ? { privateKeyFileSha256 } : {}),
    certificateAuthority: certificate.ca,
    serverAuthentication,
    loopbackIdentity,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
    validNow: Number.isFinite(validFromMs) && Number.isFinite(validToMs) && validFromMs <= now && validToMs >= now,
    ...(privateKeyMatches === undefined ? {} : { privateKeyMatches })
  };
}

async function main(argv) {
  if ((argv.length !== 2 && argv.length !== 4) || argv[0] !== "--certificate" || (argv.length === 4 && argv[2] !== "--private-key")) throw new Error("Usage: Get-B122TlsIdentity.mjs --certificate <absolute-certificate.pem> [--private-key <absolute-private-key.pem>]");
  const identity = await readTlsIdentity(argv[1], argv[3]);
  if (identity.certificateAuthority || !identity.serverAuthentication || !identity.loopbackIdentity || !identity.validNow || (argv.length === 4 && !identity.privateKeyMatches)) throw new Error("The loopback TLS identity is not a valid non-CA server identity with its exact private key.");
  process.stdout.write(`${JSON.stringify(identity)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "TLS identity inspection failed."}\n`); process.exitCode = 1; });
}
