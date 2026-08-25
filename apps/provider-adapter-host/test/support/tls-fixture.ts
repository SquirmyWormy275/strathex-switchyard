import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";

/** Runtime-generated test identity. No reusable private key is stored in source or a release artifact. */
export function createLoopbackTlsFixture(options: Readonly<{ notBefore?: Date; notAfter?: Date }> = {}): Readonly<{
  certificatePem: string;
  privateKeyPem: string;
  certificateFileSha256: string;
  privateKeyFileSha256: string;
  tlsSpkiSha256: string;
}> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const algorithm = sequence(oid("1.2.840.113549.1.1.11"), der(0x05));
  const commonName = sequence(set(sequence(oid("2.5.4.3"), utf8("127.0.0.1"))));
  const notBefore = options.notBefore ?? new Date(Date.now() - 60_000);
  const notAfter = options.notAfter ?? new Date(Date.now() + 60 * 60 * 1000);
  const subjectPublicKeyInfo = publicKey.export({ type: "spki", format: "der" });
  const subjectAlternativeName = sequence(
    oid("2.5.29.17"),
    octet(sequence(der(0x87, Buffer.from([127, 0, 0, 1]))))
  );
  const basicConstraints = sequence(oid("2.5.29.19"), der(0x01, Buffer.from([0xff])), octet(sequence()));
  const keyUsage = sequence(oid("2.5.29.15"), der(0x01, Buffer.from([0xff])), octet(bitString(Buffer.from([0xa0]))));
  const extendedKeyUsage = sequence(oid("2.5.29.37"), octet(sequence(oid("1.3.6.1.5.5.7.3.1"))));
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(randomBytes(16)),
    algorithm,
    commonName,
    sequence(utcTime(notBefore), utcTime(notAfter)),
    commonName,
    subjectPublicKeyInfo,
    der(0xa3, sequence(subjectAlternativeName, basicConstraints, keyUsage, extendedKeyUsage))
  );
  const signature = sign("RSA-SHA256", tbs, privateKey);
  const certificateDer = sequence(tbs, algorithm, bitString(signature));
  const certificatePem = pem("CERTIFICATE", certificateDer);
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const certificate = new X509Certificate(certificatePem);
  const spki = certificate.publicKey.export({ type: "spki", format: "der" });
  return {
    certificatePem,
    privateKeyPem,
    certificateFileSha256: sha256(certificatePem),
    privateKeyFileSha256: sha256(privateKeyPem),
    tlsSpkiSha256: createHash("sha256").update(spki).digest("hex")
  };
}

function sequence(...items: readonly Uint8Array[]): Buffer { return der(0x30, Buffer.concat(items.map(Buffer.from))); }
function set(...items: readonly Uint8Array[]): Buffer { return der(0x31, Buffer.concat(items.map(Buffer.from))); }
function octet(value: Uint8Array): Buffer { return der(0x04, value); }
function bitString(value: Uint8Array): Buffer { return der(0x03, Buffer.concat([Buffer.from([0]), Buffer.from(value)])); }
function utf8(value: string): Buffer { return der(0x0c, Buffer.from(value, "utf8")); }
function utcTime(value: Date): Buffer {
  const text = value.toISOString().replace(/[-:]/g, "").replace("T", "").replace(/^\d{2}/, "").replace(/\.\d{3}Z$/, "Z");
  return der(0x17, Buffer.from(text, "ascii"));
}
function integer(value: Uint8Array): Buffer {
  let bytes = Buffer.from(value);
  while (bytes.length > 1 && bytes[0] === 0 && (bytes[1]! & 0x80) === 0) bytes = bytes.subarray(1);
  if ((bytes[0]! & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}
function oid(value: string): Buffer {
  const arcs = value.split(".").map(Number);
  if (arcs.length < 2 || arcs.some((arc) => !Number.isSafeInteger(arc) || arc < 0)) throw new Error("Invalid test OID.");
  const bytes = [arcs[0]! * 40 + arcs[1]!];
  for (const arc of arcs.slice(2)) {
    const encoded = [arc & 0x7f];
    for (let current = Math.floor(arc / 128); current > 0; current = Math.floor(current / 128)) encoded.unshift((current & 0x7f) | 0x80);
    bytes.push(...encoded);
  }
  return der(0x06, Buffer.from(bytes));
}
function der(tag: number, value: Uint8Array = Buffer.alloc(0)): Buffer {
  const length = value.byteLength;
  const encodedLength = length < 128
    ? Buffer.from([length])
    : (() => { const bytes: number[] = []; for (let current = length; current > 0; current = Math.floor(current / 256)) bytes.unshift(current & 0xff); return Buffer.from([0x80 | bytes.length, ...bytes]); })();
  return Buffer.concat([Buffer.from([tag]), encodedLength, Buffer.from(value)]);
}
function pem(label: string, value: Uint8Array): string {
  const base64 = Buffer.from(value).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`;
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
