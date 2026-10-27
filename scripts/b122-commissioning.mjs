#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = join(root, "packages", "protocol", "generated", "b122-control-map.json");
export const modifiers = ["normal", "shift", "alt", "shift_alt", "ctrl", "ctrl_shift", "ctrl_alt", "ctrl_shift_alt"];
export const lifecycleCases = ["hotplug", "suspendResume", "vialCoexistence", "rollover", "leds", "solenoid"];
const knownNonB122Serials = new Set(["vial:f64c2b3c"]);

function fail(message) { throw new Error(message); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function placeholder(value) { return typeof value !== "string" || value.trim() === "" || /^(?:unknown|unset|placeholder|todo|tbd|xxxx|0000)$/iu.test(value.trim()); }
function parseProperties(text) {
  const result = {};
  for (const line of text.split(/\r?\n/u)) {
    const index = line.indexOf("=");
    if (index > 0) result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}
async function readBounded(path, maximum = 16_384) {
  const value = await readFile(path);
  if (value.length > maximum) fail(`Refusing oversized sysfs value: ${path}`);
  return value;
}
async function readOptional(path, maximum = 4_096) {
  try { return (await readBounded(path, maximum)).toString("utf8").trim(); }
  catch (error) { if (error?.code === "ENOENT" || error?.code === "EACCES") return null; throw error; }
}
async function usbIdentity(start) {
  let current = start;
  for (let depth = 0; depth < 12 && current.startsWith("/sys/devices/"); depth += 1) {
    const vendorId = await readOptional(join(current, "idVendor"));
    const productId = await readOptional(join(current, "idProduct"));
    if (vendorId && productId) {
      return {
        vendorId: vendorId.toLowerCase(), productId: productId.toLowerCase(),
        manufacturer: await readOptional(join(current, "manufacturer")),
        product: await readOptional(join(current, "product")),
        serial: await readOptional(join(current, "serial"))
      };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function captureLinuxHidraw({ sysClassRoot = "/sys/class/hidraw" } = {}) {
  if (process.platform !== "linux" && sysClassRoot === "/sys/class/hidraw") fail("Read-only hidraw capture requires Linux.");
  const entries = (await readdir(sysClassRoot, { withFileTypes: true })).filter((entry) => /^hidraw\d+$/u.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name, "en"));
  const candidates = [];
  for (const entry of entries) {
    const link = join(sysClassRoot, entry.name, "device");
    const sysfsPath = await realpath(link);
    if (!sysfsPath.startsWith("/sys/devices/") && sysClassRoot === "/sys/class/hidraw") fail(`Unexpected hidraw sysfs target: ${sysfsPath}`);
    const descriptor = await readBounded(join(sysfsPath, "report_descriptor"));
    const uevent = parseProperties((await readBounded(join(sysfsPath, "uevent"), 8_192)).toString("utf8"));
    candidates.push({
      hidrawNode: `/dev/${entry.name}`,
      sysfsPath,
      hidId: uevent.HID_ID ?? null,
      hidName: uevent.HID_NAME ?? null,
      hidUnique: uevent.HID_UNIQ ?? null,
      reportDescriptorSha256: createHash("sha256").update(descriptor).digest("hex"),
      reportDescriptorBytes: descriptor.length,
      usb: await usbIdentity(sysfsPath)
    });
  }
  return { schema: "sxsy-b122-hidraw-capture/v1", capturedAt: new Date().toISOString(), readOnly: true, deviceNodesOpened: false, candidates };
}

export async function loadControlMap(path = mapPath) {
  const data = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(data.controls) || data.controls.length !== 22 || new Set(data.controls).size !== 22) fail("Canonical map must contain exactly 22 unique controls.");
  if (!Array.isArray(data.assignments) || data.assignments.length !== 65) fail("Canonical map must contain exactly 65 assignments.");
  const assignmentByChord = new Map();
  for (const assignment of data.assignments) {
    const key = `${assignment.control}:${assignment.modifier}`;
    if (assignmentByChord.has(key)) fail(`Duplicate canonical assignment: ${key}`);
    assignmentByChord.set(key, assignment);
  }
  return { data, assignmentByChord };
}

export async function createCommissioningPlan(path = mapPath) {
  const { data, assignmentByChord } = await loadControlMap(path);
  const slots = data.controls.flatMap((control) => modifiers.map((modifier) => {
    const assignment = assignmentByChord.get(`${control}:${modifier}`);
    return {
      control, modifier,
      expectedOutcome: assignment ? "dispatched" : "inert",
      expectedHandler: assignment?.handler ?? null,
      capability: assignment?.capability ?? "intentionally_unassigned"
    };
  }));
  if (slots.length !== 176) fail("Commissioning plan must contain 176 chord slots.");
  return {
    schema: "sxsy-b122-commissioning-plan/v1",
    sourceSchema: data.schema,
    sourceProtocolVersion: data.protocolVersion,
    physicalPositionStatus: "unassigned-within-bank",
    slots,
    lifecycleRequirements: lifecycleCases
  };
}

function validateCapture(capture) {
  if (!isRecord(capture) || capture.schema !== "sxsy-b122-hidraw-capture/v1" || capture.readOnly !== true || capture.deviceNodesOpened !== false || !Array.isArray(capture.candidates)) fail("Capture receipt is invalid or not demonstrably read-only.");
}
function validateIdentity(identity, capture) {
  if (!isRecord(identity)) fail("Observed device identity is required.");
  for (const field of ["hidrawNode", "sysfsPath", "vendorId", "productId", "reportDescriptorSha256"]) if (placeholder(identity[field])) fail(`Observed identity field is missing or a placeholder: ${field}`);
  if (!/^[0-9a-f]{4}$/u.test(identity.vendorId) || !/^[0-9a-f]{4}$/u.test(identity.productId) || !/^[0-9a-f]{64}$/u.test(identity.reportDescriptorSha256)) fail("Observed device identity has invalid normalized values.");
  if (identity.serial && knownNonB122Serials.has(String(identity.serial).toLowerCase())) fail("The selected identity is the known F77 device, not an observed B122.");
  const candidate = capture.candidates.find((item) => item.hidrawNode === identity.hidrawNode && item.sysfsPath === identity.sysfsPath && item.reportDescriptorSha256 === identity.reportDescriptorSha256 && item.usb?.vendorId === identity.vendorId && item.usb?.productId === identity.productId);
  if (!candidate) fail("Observed identity does not exactly match a read-only capture candidate.");
  if (candidate.usb?.serial && identity.serial !== candidate.usb.serial) fail("Observed serial does not match the capture candidate.");
}
function validateLifecycle(lifecycle) {
  if (!isRecord(lifecycle)) fail("Lifecycle evidence is required.");
  for (const name of lifecycleCases) {
    const receipt = lifecycle[name];
    if (!isRecord(receipt) || receipt.passed !== true || Number.isNaN(Date.parse(receipt.observedAt)) || placeholder(receipt.evidence)) fail(`Lifecycle case is incomplete or did not pass: ${name}`);
  }
}

export async function verifyCommissioning({ capture, observations, map = mapPath }) {
  validateCapture(capture);
  if (!isRecord(observations) || observations.schema !== "sxsy-b122-commissioning-observations/v1") fail("Commissioning observations have the wrong schema.");
  validateIdentity(observations.device, capture);
  validateLifecycle(observations.lifecycle);
  const plan = await createCommissioningPlan(map);
  if (!Array.isArray(observations.slots)) fail("Commissioning observations must contain chord slots.");
  const actual = new Map();
  for (const slot of observations.slots) {
    const key = `${slot?.control}:${slot?.modifier}`;
    if (actual.has(key)) fail(`Duplicate observed chord slot: ${key}`);
    actual.set(key, slot);
  }
  const errors = [];
  for (const expected of plan.slots) {
    const key = `${expected.control}:${expected.modifier}`;
    const observed = actual.get(key);
    if (!observed) { errors.push(`missing ${key}`); continue; }
    if (observed.outcome !== expected.expectedOutcome) errors.push(`${key} expected ${expected.expectedOutcome}, observed ${observed.outcome}`);
    if ((observed.handler ?? null) !== expected.expectedHandler) errors.push(`${key} expected handler ${expected.expectedHandler ?? "null"}, observed ${observed.handler ?? "null"}`);
    actual.delete(key);
  }
  for (const key of actual.keys()) errors.push(`unknown ${key}`);
  if (errors.length) fail(`Commissioning observations failed (${errors.length}): ${errors.slice(0, 12).join("; ")}`);
  return {
    schema: "sxsy-b122-commissioning-verification/v1",
    verifiedAt: new Date().toISOString(),
    passed: true,
    observedDevice: observations.device,
    totals: { controls: 22, modifiers: 8, slots: 176, assigned: 65, intentionallyUnassigned: 111, lifecycleCases: lifecycleCases.length },
    acceptanceMutationPerformed: false
  };
}

async function readJson(path) { return JSON.parse(await readFile(resolve(path), "utf8")); }
function valueAfter(args, name) { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) fail(`Missing ${name} FILE`); return args[index + 1]; }
async function main(args) {
  const command = args[0];
  let output;
  if (command === "capture") output = await captureLinuxHidraw();
  else if (command === "plan") output = await createCommissioningPlan();
  else if (command === "verify") output = await verifyCommissioning({ capture: await readJson(valueAfter(args, "--capture")), observations: await readJson(valueAfter(args, "--observations")) });
  else fail("usage: b122-commissioning.mjs capture | plan | verify --capture FILE --observations FILE");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { process.stderr.write(`ERROR: ${error.message}\n`); process.exitCode = 1; });
