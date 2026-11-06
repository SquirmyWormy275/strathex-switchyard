/** Read-only PE proof for the exact native setup image. No DLL is loaded here. */
import assert from "node:assert/strict";

export function verifyNativeSetupImage(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 512 && bytes.length <= 16 * 1024 * 1024);
  const range = (offset, length) => { assert.ok(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= bytes.length); return offset; };
  const u16 = offset => bytes.readUInt16LE(range(offset, 2)), u32 = offset => bytes.readUInt32LE(range(offset, 4));
  assert.equal(u16(0), 0x5a4d); const pe = u32(0x3c); assert.equal(u32(pe), 0x4550); assert.equal(u16(pe + 4), 0x8664);
  const optional = pe + 24, optionalSize = u16(pe + 20), sections = u16(pe + 6), table = optional + optionalSize;
  assert.equal(u16(optional), 0x20b); assert.ok(optionalSize >= 112 + 14 * 8 && sections > 0 && sections < 32); range(optional, optionalSize); range(table, sections * 40);
  assert.ok(u32(optional + 108) >= 14);
  const rva = (value, length) => {
    assert.ok(value > 0 && value + length <= 0x100000000);
    const matches = [];
    for (let i = 0; i < sections; i++) {
      const entry = table + i * 40, start = u32(entry + 12), rawSize = u32(entry + 16);
      if (value >= start && value + length <= start + rawSize) matches.push(range(u32(entry + 20) + value - start, length));
    }
    assert.equal(matches.length, 1); return matches[0];
  };
  const directory = index => ({ value: u32(optional + 112 + index * 8), size: u32(optional + 116 + index * 8) });
  const config = directory(10); assert.ok(config.size >= 80); const configuration = rva(config.value, 80);
  assert.ok(u32(configuration) >= 80); assert.equal(u16(configuration + 78), 0x800);
  const name = value => {
    const chars = [];
    for (let i = 0; i <= 80; i++) {
      const character = bytes[rva(value + i, 1)];
      if (character === 0) { const text = String.fromCharCode(...chars).toLowerCase(); assert.match(text, /^[a-z0-9][a-z0-9._-]*\.dll$/); return text; }
      assert.ok(character >= 0x21 && character <= 0x7e); chars.push(character);
    }
    throw Error("Native setup DLL name exceeds its bound.");
  };
  const imports = delayed => {
    const entry = directory(delayed ? 13 : 1), width = delayed ? 32 : 20;
    assert.ok(entry.size >= width && entry.size <= 16384); const start = rva(entry.value, entry.size), names = [];
    for (let offset = 0; offset + width <= entry.size && names.length <= 128; offset += width) {
      const at = start + offset, fields = Array.from({ length: width / 4 }, (_, i) => u32(at + i * 4));
      if (fields.every(value => value === 0)) { assert.ok(names.length > 0 && new Set(names).size === names.length); return names.sort(); }
      if (delayed) assert.equal(fields[0], 1, "Delay descriptors must contain RVAs, not absolute addresses.");
      names.push(name(fields[delayed ? 1 : 3]));
    }
    throw Error("Native setup import descriptors are unterminated or oversized.");
  };
  const eager = imports(false), delayed = imports(true);
  assert.deepEqual(delayed, ["ole32.dll", "shell32.dll"]);
  assert.ok(!eager.some(dll => ["ole32.dll", "shell32.dll", "user32.dll", "gdi32.dll", "combase.dll", "oleaut32.dll"].includes(dll)), "Metadata must not eagerly import UI libraries.");
  return { dependentLoadFlags: 0x800, deferredUiImportsVerified: true, runtimeModuleIsolationVerified: false };
}
