#!/usr/bin/env node
import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const arguments_ = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => index % 2 === 0 ? [...pairs, [value, values[index + 1]]] : pairs, []));
const certificatePath = exactOutput(arguments_["--certificate"], "certificate");
const privateKeyPath = exactOutput(arguments_["--private-key"], "private key");
if (certificatePath === privateKeyPath) fail();
await Promise.all([absent(certificatePath), absent(privateKeyPath)]);

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
const algorithm = sequence(oid("1.2.840.113549.1.1.11"), der(0x05));
const commonName = sequence(set(sequence(oid("2.5.4.3"), utf8("127.0.0.1"))));
const notBefore = new Date(Date.now() - 5 * 60_000);
const notAfter = new Date(Date.now() + 90 * 24 * 60 * 60_000);
const subjectPublicKeyInfo = publicKey.export({ type: "spki", format: "der" });
const subjectAlternativeName = sequence(oid("2.5.29.17"), octet(sequence(der(0x87, Buffer.from([127, 0, 0, 1])))));
const basicConstraints = sequence(oid("2.5.29.19"), der(0x01, Buffer.from([0xff])), octet(sequence()));
const keyUsage = sequence(oid("2.5.29.15"), der(0x01, Buffer.from([0xff])), octet(bitString(Buffer.from([0xa0]))));
const extendedKeyUsage = sequence(oid("2.5.29.37"), octet(sequence(oid("1.3.6.1.5.5.7.3.1"))));
const tbs = sequence(der(0xa0, integer(Buffer.from([2]))), integer(randomBytes(20)), algorithm, commonName, sequence(utcTime(notBefore), utcTime(notAfter)), commonName, subjectPublicKeyInfo, der(0xa3, sequence(subjectAlternativeName, basicConstraints, keyUsage, extendedKeyUsage)));
const certificateDer = sequence(tbs, algorithm, bitString(sign("RSA-SHA256", tbs, privateKey)));
const certificatePem = pem("CERTIFICATE", certificateDer);
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
await writeFile(certificatePath, certificatePem, { encoding: "utf8", flag: "wx", mode: 0o600 });
try { await writeFile(privateKeyPath, privateKeyPem, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
catch (error) { await import("node:fs/promises").then(({ unlink }) => unlink(certificatePath).catch(() => undefined)); throw error; }
const certificate = new X509Certificate(certificatePem);
const tlsSpkiSha256 = createHash("sha256").update(certificate.publicKey.export({ type: "spki", format: "der" })).digest("hex");
process.stdout.write(`${JSON.stringify({ schema: "sxsy-b122.loopback-tls-identity", version: 1, certificatePath, privateKeyPath, certificateFileSha256: sha(certificatePem), privateKeyFileSha256: sha(privateKeyPem), tlsSpkiSha256, host: "127.0.0.1", generated: true, certificateAuthority: false, serverAuthentication: true, validFrom: certificate.validFrom, validTo: certificate.validTo })}\n`);

function exactOutput(value, label) { if (typeof value !== "string" || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error(`The loopback TLS ${label} output path must be absolute.`); return resolve(value); }
async function absent(path) { try { await lstat(path); throw new Error("The loopback TLS output already exists."); } catch (error) { if (error?.code !== "ENOENT") throw error; } }
function sequence(...items) { return der(0x30, Buffer.concat(items.map(Buffer.from))); }
function set(...items) { return der(0x31, Buffer.concat(items.map(Buffer.from))); }
function octet(value) { return der(0x04, value); }
function bitString(value) { return der(0x03, Buffer.concat([Buffer.from([0]), Buffer.from(value)])); }
function utf8(value) { return der(0x0c, Buffer.from(value, "utf8")); }
function utcTime(value) { return der(0x17, Buffer.from(value.toISOString().replace(/[-:]/g, "").replace("T", "").replace(/^\d{2}/, "").replace(/\.\d{3}Z$/, "Z"), "ascii")); }
function integer(value) { let bytes = Buffer.from(value); while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes = bytes.subarray(1); if ((bytes[0] & 0x80) !== 0) bytes = Buffer.concat([Buffer.from([0]), bytes]); return der(0x02, bytes); }
function oid(value) { const arcs = value.split(".").map(Number); const bytes = [arcs[0] * 40 + arcs[1]]; for (const arc of arcs.slice(2)) { const encoded = [arc & 0x7f]; for (let current = Math.floor(arc / 128); current > 0; current = Math.floor(current / 128)) encoded.unshift((current & 0x7f) | 0x80); bytes.push(...encoded); } return der(0x06, Buffer.from(bytes)); }
function der(tag, value = Buffer.alloc(0)) { const length = value.byteLength; const encodedLength = length < 128 ? Buffer.from([length]) : (() => { const bytes = []; for (let current = length; current > 0; current = Math.floor(current / 256)) bytes.unshift(current & 0xff); return Buffer.from([0x80 | bytes.length, ...bytes]); })(); return Buffer.concat([Buffer.from([tag]), encodedLength, Buffer.from(value)]); }
function pem(label, value) { const base64 = Buffer.from(value).toString("base64").match(/.{1,64}/g)?.join("\n") ?? ""; return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`; }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function fail() { throw new Error("Loopback TLS certificate and private-key outputs must differ."); }
