import test from "node:test";
import assert from "node:assert/strict";
import { createEditorClientFrames, editorJsonObject, editorServerFrame, editorMessageBytes } from "./editor-websocket-frames.mjs";

function clientFrame(opcode, payload, final = true) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload), server = editorServerFrame(opcode === 0 ? 1 : opcode, bytes), header = Buffer.from(server.subarray(0, server.length - bytes.length));
  header[0] = (final ? 0x80 : 0) | opcode; header[1] |= 0x80; const mask = Buffer.from([1, 2, 3, 4]), body = Buffer.from(bytes);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4]; return Buffer.concat([header, mask, body]);
}

test("split UTF-8 text, interleaved ping and sequential messages retain exact JSON objects", () => {
  const decoder = createEditorClientFrames(), text = Buffer.from('{"text":"é","nested":{"ok":true}}'), cut = text.indexOf(0xc3) + 1;
  const frames = Buffer.concat([clientFrame(1, text.subarray(0, cut), false), clientFrame(9, "ping"), clientFrame(0, text.subarray(cut)), clientFrame(1, '{"id":2}')]), events = [];
  for (const byte of frames) { decoder.push(Buffer.from([byte])); for (let e; (e = decoder.next());) events.push(e); }
  assert.deepEqual(events, [{ kind: "fragment" }, { kind: "ping", payload: Buffer.from("ping") }, { kind: "message", message: { text: "é", nested: { ok: true } } }, { kind: "message", message: { id: 2 } }]); decoder.close();
});

test("JSON refuses duplicate escaped/nested keys, invalid UTF-8, lone surrogates, nonfinite numbers and excessive nesting", () => {
  for (const value of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"x":1,"x":2}}', '{"n":1e999}', '{"v":"\\ud800"}', '{"\\ud800":1}', '[]', 'null', '{"x":'+ '['.repeat(33)+'0'+']'.repeat(33)+'}']) assert.throws(() => editorJsonObject(Buffer.from(value)));
  assert.throws(() => editorJsonObject(Buffer.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125])));
  assert.deepEqual(editorJsonObject(Buffer.from('{"left":{"a":1},"right":{"a":2},"v":"a:b"}')), { left: { a: 1 }, right: { a: 2 }, v: "a:b" });
});

test("masked frame structure refuses reserved bits, binary, missing masks, noncanonical lengths and control fragmentation", () => {
  const bad = [];
  for (const change of [[0, 0xc1], [0, 0x82], [1, 2]]) { const value = clientFrame(1, '{}'); value[change[0]] = change[1]; bad.push(value); }
  bad.push(Buffer.from([0x81, 0xfe, 0, 2, 1, 2, 3, 4, 0, 0]), clientFrame(9, 'x', false), clientFrame(0, '{}'));
  const huge = Buffer.alloc(10); huge[0] = 0x81; huge[1] = 0xff; huge.writeBigUInt64BE(BigInt(editorMessageBytes + 1), 2); bad.push(huge);
  for (const bytes of bad) { const d = createEditorClientFrames(); d.push(bytes); assert.throws(() => d.next()); d.close(); }
  const d = createEditorClientFrames(); d.push(clientFrame(1, '{', false)); d.next(); d.push(clientFrame(1, '{}')); assert.throws(() => d.next()); d.close();
});

test("message and fragment count bounds hold even for empty continuations", () => {
  const d = createEditorClientFrames(); d.push(clientFrame(1, '', false)); d.next();
  for (let i = 1; i < 1024; i++) { d.push(clientFrame(0, '', false)); d.next(); }
  d.push(clientFrame(0, '', false)); assert.throws(() => d.next()); d.close();
  const large = createEditorClientFrames(); large.push(clientFrame(1, Buffer.alloc(editorMessageBytes, 32), false)); large.next(); large.push(clientFrame(0, 'x')); assert.throws(() => large.next()); large.close();
});

test("close codes and UTF-8 reasons are validated and no data can follow closure", () => {
  const payload = Buffer.from([3, 232, ...Buffer.from('done')]), d = createEditorClientFrames(); d.push(clientFrame(8, payload)); assert.deepEqual(d.next(), { kind: 'close', payload }); assert.throws(() => d.push(clientFrame(1, '{}')));
  for (const bytes of [Buffer.from([1]), Buffer.from([3, 237]), Buffer.from([3, 232, 0xff])]) { const decoder = createEditorClientFrames(); decoder.push(clientFrame(8, bytes)); assert.throws(() => decoder.next()); decoder.close(); }
});
