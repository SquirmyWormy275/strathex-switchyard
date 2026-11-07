/** Bounded RFC 6455 server-side text framing. No transport or task authority. */
export const editorMessageBytes = 1048576;
export const editorBufferBytes = editorMessageBytes + 65536;
const require = value => { if (!value) throw Error("The bounded editor WebSocket frame did not verify."); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const utf8 = bytes => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

export function editorJsonObject(bytes) {
  require(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= editorMessageBytes);
  const text = utf8(bytes), value = JSON.parse(text, (_key, v) => { require(typeof v !== "number" || Number.isFinite(v)); require(typeof v !== "string" || v.isWellFormed()); return v; });
  require(object(value));
  // JSON.parse accepts duplicate keys. Check decoded keys in every object,
  // including escaped spellings, with a bounded structural depth.
  const stack = [], tokens = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]]/g;
  for (const match of text.matchAll(tokens)) {
    const item = match[0];
    if (item === "{" || item === "[") { stack.push(item === "{" ? new Set() : null); require(stack.length <= 32); }
    else if (item === "}" || item === "]") stack.pop();
    else if (/^[ \t\r\n]*:/.test(text.slice(match.index + item.length))) {
      const keys = stack.at(-1), key = JSON.parse(item); require(keys && key.isWellFormed() && !keys.has(key)); keys.add(key);
    }
  }
  return value;
}

export function editorServerFrame(opcode, payload) {
  require([1, 8, 9, 10].includes(opcode) && Buffer.isBuffer(payload) && payload.length <= editorMessageBytes && (opcode < 8 || payload.length <= 125));
  const size = payload.length, header = Buffer.alloc(size < 126 ? 2 : size < 65536 ? 4 : 10);
  header[0] = 0x80 | opcode;
  if (size < 126) header[1] = size;
  else if (size < 65536) { header[1] = 126; header.writeUInt16BE(size, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(size), 2); }
  return Buffer.concat([header, payload]);
}

export function createEditorClientFrames() {
  let incoming = Buffer.alloc(0), fragments = [], fragmentBytes = 0, fragmented = false, closed = false;
  const clear = () => { incoming.fill(0); for (const b of fragments) b.fill(0); incoming = Buffer.alloc(0); fragments = []; fragmentBytes = 0; fragmented = false; };
  return Object.freeze({
    push(bytes) { require(!closed && Buffer.isBuffer(bytes) && incoming.length + bytes.length <= editorBufferBytes); incoming = Buffer.concat([incoming, bytes]); },
    next() {
      require(!closed);
      if (incoming.length < 2) return undefined;
      const first = incoming[0], second = incoming[1], final = !!(first & 0x80), opcode = first & 15;
      require(!(first & 0x70) && !!(second & 0x80) && [0, 1, 8, 9, 10].includes(opcode));
      let size = second & 0x7f, offset = 2;
      if (size === 126) { if (incoming.length < 4) return undefined; size = incoming.readUInt16BE(2); offset = 4; require(size >= 126); }
      else if (size === 127) { if (incoming.length < 10) return undefined; const length = incoming.readBigUInt64BE(2); require(length >= 65536n && length <= BigInt(editorMessageBytes)); size = Number(length); offset = 10; }
      require(size <= editorMessageBytes && (opcode < 8 || final && size <= 125));
      if (incoming.length < offset + 4 + size) return undefined;
      const payload = Buffer.alloc(size), mask = incoming.subarray(offset, offset + 4);
      for (let i = 0; i < size; i++) payload[i] = incoming[offset + 4 + i] ^ mask[i % 4];
      incoming = incoming.subarray(offset + 4 + size);
      if (opcode === 8) {
        require(size !== 1);
        if (size) { const code = payload.readUInt16BE(0); require([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code) || code >= 3000 && code <= 4999); utf8(payload.subarray(2)); }
        closed = true; clear(); return { kind: "close", payload };
      }
      if (opcode === 9 || opcode === 10) return { kind: opcode === 9 ? "ping" : "pong", payload };
      require(opcode === 1 && !fragmented || opcode === 0 && fragmented);
      fragmentBytes += size; require(fragmentBytes <= editorMessageBytes && fragments.length < 1024); fragments.push(payload); fragmented = !final;
      if (!final) return { kind: "fragment" };
      const bytes = Buffer.concat(fragments, fragmentBytes); let message;
      try { message = editorJsonObject(bytes); } finally { bytes.fill(0); for (const b of fragments) b.fill(0); fragments = []; fragmentBytes = 0; }
      return { kind: "message", message };
    },
    close() { closed = true; clear(); }
  });
}
