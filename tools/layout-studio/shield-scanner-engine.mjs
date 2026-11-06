/** Pinned, dependency-free baseline scanner. Never executes scanned code or feed patterns. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const shieldEngineVersion = "switchyard-baseline-scanner/1";

/** Bounded AND/OR/WITH declaration syntax, not license-list or legal verification. */
export function npmLicenseDeclaration(value, allowedLicenses = []) {
  if (typeof value !== "string" || !value || value.length > 512 || /[^A-Za-z0-9.()+ \t-]/.test(value)) return null;
  const tokens = []; let offset = 0;
  while (offset < value.length) {
    if (/[ \t]/.test(value[offset])) { offset++; continue; }
    const match = /^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,79}\+?|[()])/.exec(value.slice(offset));
    if (!match || tokens.length >= 128) return null;
    if (["AND", "OR"].includes(match[0]) && (offset > 0 && !/[ \t()]/.test(value[offset - 1]) || offset + match[0].length < value.length && !/[ \t()]/.test(value[offset + match[0].length]))) return null;
    if (match[0] === "WITH" && (offset === 0 || !/[ \t]/.test(value[offset - 1]) || !/[ \t]/.test(value[offset + match[0].length] ?? ""))) return null;
    tokens.push(match[0]); offset += match[0].length;
  }
  let cursor = 0, atoms = 0, choice = false;
  const atom = depth => {
    if (depth > 16) throw Error("License expression nesting exceeds its bound.");
    const token = tokens[cursor++];
    if (token === "(") { const result = disjunction(depth + 1); if (tokens[cursor++] !== ")") throw Error("Unclosed license expression."); return result; }
    if (!token || ["AND", "OR", "WITH", "(", ")", "NONE", "NOASSERTION"].includes(token) || /^(?:LicenseRef-|DocumentRef-)/i.test(token) || ++atoms > 64) throw Error("Unsupported license declaration.");
    if (tokens[cursor] === "WITH") {
      cursor++; const exception = tokens[cursor++];
      if (!exception || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/.test(exception)
          || ["AND", "OR", "WITH", "NONE", "NOASSERTION"].includes(exception)
          || /^(?:LicenseRef-|DocumentRef-)/i.test(exception) || ++atoms > 64) throw Error("Unsupported license exception declaration.");
      return { atom: `${token} WITH ${exception}` };
    }
    return { atom: token };
  };
  const conjunction = depth => { let result = atom(depth); while (tokens[cursor] === "AND") { cursor++; result = { op: "AND", left: result, right: atom(depth) }; } return result; };
  const disjunction = depth => { let result = conjunction(depth); while (tokens[cursor] === "OR") { cursor++; choice = true; result = { op: "OR", left: result, right: conjunction(depth) }; } return result; };
  try {
    const tree = disjunction(0); if (cursor !== tokens.length) return null;
    const render = (node, parent = 0) => {
      if (node.atom) return node.atom;
      const precedence = node.op === "AND" ? 2 : 1;
      const text = `${render(node.left, precedence)} ${node.op} ${render(node.right, precedence)}`;
      return precedence < parent ? `(${text})` : text;
    };
    const expression = render(tree); if (expression.length > 512) return null;
    const allowed = new Set(allowedLicenses.map(id => id.toLowerCase()));
    const evaluate = node => node.atom ? allowed.has(node.atom.toLowerCase()) : node.op === "AND" ? evaluate(node.left) && evaluate(node.right) : evaluate(node.left) || evaluate(node.right);
    return { expression, allowed: evaluate(tree), choice };
  } catch { return null; }
}
export const shieldIndexPrefix = ".switchyard-index/";
export const shieldHistoryPrefix = ".switchyard-history/";
export const shieldReservedPath = path => [shieldIndexPrefix,shieldHistoryPrefix].some(prefix=>path===prefix.slice(0,-1)||path?.startsWith(prefix));
export const shieldActions = Object.freeze(["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);
const dimensions = {
  shield_change_scan: ["secrets", "pii", "security_defects"],
  shield_codebase_audit: ["secrets", "history", "insecure_paths", "permissions", "infrastructure"],
  shield_supply_chain: ["vulnerabilities", "licenses", "provenance", "sbom"],
  release_shield: ["secrets", "pii", "security_defects", "history", "insecure_paths", "permissions", "infrastructure", "vulnerabilities", "licenses", "provenance", "sbom", "isolation"]
};
// Patterns are code-owned, bounded and intentionally heuristic. Feeds choose fixed
// rule identifiers; they cannot supply a regex, executable, argument or URL to fetch.
const rules = Object.freeze({
  "secret.private-key": { dimension: "secrets", severity: "critical", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
  "secret.github-token": { dimension: "secrets", severity: "high", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g },
  "secret.aws-access-key": { dimension: "secrets", severity: "high", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  "pii.email": { dimension: "pii", severity: "medium", pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,128}\.[A-Za-z]{2,24}\b/g },
  "javascript.dynamic-code": { dimension: "security_defects", severity: "high", extensions: ["js", "mjs", "cjs", "ts", "tsx", "jsx"], pattern: /\b(?:eval\s*\(|new\s+Function\s*\()/g },
  "config.tls-verification-disabled": { dimension: "infrastructure", severity: "high", pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']?0)/g },
  "docker.privileged": { dimension: "infrastructure", severity: "high", extensions: ["yaml", "yml", "json"], pattern: /["']?privileged["']?\s*:\s*true/g },
  "path.request-traversal": { dimension: "insecure_paths", severity: "high", extensions: ["js", "mjs", "cjs", "ts", "tsx", "jsx"], pattern: /\b(?:join|resolve)\s*\([^\n;]{0,256}\b(?:req|request)\.(?:query|params|body)\b/g }
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
function exact(v, keys) { if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw Error("Invalid closed scanner document."); }
function identifier(v) { if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) throw Error("Invalid scanner identifier."); return v; }
function digest(v) { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw Error("Invalid scanner digest."); return v; }
export function scannerPath(v) { if (typeof v !== "string" || v.length > 512 || v.includes("\\") || v.split("/").some(s => !s || s === "." || s === ".." || /[\x00-\x1f\x7f:]/.test(s)) || isAbsolute(v)) throw Error("Invalid relative scanner input."); return v; }
function array(v, limit) { if (!Array.isArray(v) || v.length > limit) throw Error("Scanner array exceeds its bound."); return v; }
function utf8(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function json(bytes) { if (bytes.length > 2 * 1024 * 1024) throw Error("Scanner JSON exceeds its bound."); return JSON.parse(utf8(bytes)); }
// Cargo lock parsing stays inside the one digest-pinned, dependency-free worker.
const cargoRequire = value => { if (!value) throw Error('Unsupported bounded Cargo lock metadata.'); };
const cargoDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const cargoPublicSource = 'registry+https://github.com/rust-lang/crates.io-index';
export const cargoPublicSourceSha256 = sha(cargoPublicSource);
export const isCargoLockPath = path => typeof path === 'string' && path.length <= 512 && path.split('/').at(-1) === 'Cargo.lock' && path.split('/').every(part => part && !['.','..'].includes(part) && !/[\\\x00-\x1f\x7f:]/.test(part));
export function parseCargoVersion(version) {
  cargoRequire(typeof version === 'string' && version.length <= 256 && /^[0-9A-Za-z.+-]+$/.test(version));
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  cargoRequire(match);
  const core = match.slice(1, 4), pre = match[4]?.split('.') ?? [], build = match[5]?.split('.') ?? [];
  cargoRequire(core.every(part => BigInt(part) <= 18446744073709551615n));
  cargoRequire(pre.every(part => !/^[0-9]+$/.test(part) || part === '0' || part[0] !== '0'));
  return { core, pre, build };
}
/** SemVer precedence ignores build metadata; inventory identity retains it. */
export function compareCargoVersions(left, right) {
  const a = parseCargoVersion(left), b = parseCargoVersion(right);
  const numeric = (x, y) => x.length !== y.length ? (x.length < y.length ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0;
  for (let i = 0; i < 3; i++) { const order = numeric(a.core[i], b.core[i]); if (order) return order; }
  if (!a.pre.length || !b.pre.length) return !a.pre.length && !b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i], xn = /^[0-9]+$/.test(x), yn = /^[0-9]+$/.test(y);
    const order = xn && yn ? numeric(x, y) : xn !== yn ? (xn ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0;
    if (order) return order;
  }
  return a.pre.length < b.pre.length ? -1 : a.pre.length > b.pre.length ? 1 : 0;
}
export function cargoIdentity(name, version) {
  cargoRequire(typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name));
  parseCargoVersion(version);
  return { name, version };
}
export function cratesIoIdentity(name,version) {
  cargoIdentity(name,version);cargoRequire(/^[a-z][a-z0-9_-]{0,63}$/.test(name));return{ecosystem:'crates.io',name,version};
}
// This accepts the basic strings emitted by Cargo, not arbitrary TOML. In
// particular, JSON-only escapes, multiline strings and extra tables refuse.
const cargoQuoted = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\bfnrt]|u(?![dD][89a-fA-F])[0-9a-fA-F]{4}))*"/;
function cargoUncomment(line) {
  let result = '', rest = line;
  while (rest) {
    if (rest[0] === '#') break;
    if (rest[0] === '"') { const match=cargoQuoted.exec(rest);cargoRequire(match);result+=match[0];rest=rest.slice(match[0].length); }
    else { cargoRequire(/^[\t\x20-\x7e]$/.test(rest[0]));result+=rest[0];rest=rest.slice(1); }
  }
  return result.trim();
}
function cargoString(value) {
  cargoRequire(cargoQuoted.exec(value)?.[0] === value);const parsed=JSON.parse(value);
  cargoRequire(parsed.length > 0 && parsed.length <= 2048 && parsed.isWellFormed() && !/[\x00-\x1f\x7f]/.test(parsed));return parsed;
}
function cargoDependencyList(value) {
  cargoRequire(value[0] === '[' && value.at(-1) === ']');let rest=value.slice(1,-1).trim();const rows=[];
  while(rest) { const match=cargoQuoted.exec(rest);cargoRequire(match);const item=cargoString(match[0]);cargoRequire(rows.length<4096);rows.push(item);rest=rest.slice(match[0].length).trim();if(!rest)break;cargoRequire(rest[0]===',');rest=rest.slice(1).trim(); }
  cargoRequire(new Set(rows).size===rows.length);return rows;
}
export function parseCargoLock(text) {
  cargoRequire(typeof text==='string' && text.isWellFormed() && Buffer.byteLength(text)<=1024*1024 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) && !/\r(?!\n)/.test(text));
  const lines=text.replaceAll('\r\n','\n').split('\n');cargoRequire(lines.length<=32768 && lines.every(line=>line.length<=8192));
  const packages=[];let version, row, list;
  for(const raw of lines) {
    const line=cargoUncomment(raw);if(!line)continue;
    if(list!==undefined) { cargoRequire(list.length+line.length<=256*1024);list+=' '+line;if(line.endsWith(']')){row.dependencies=cargoDependencyList(list);list=undefined;}continue; }
    if(line==='[[package]]'){cargoRequire(version!==undefined && packages.length<4096);row={};packages.push(row);continue;}
    const match=/^([a-z][a-z0-9_-]*)\s*=\s*(.*)$/.exec(line);cargoRequire(match);const [,key,value]=match;
    if(!row){cargoRequire(version===undefined && key==='version' && ['3','4'].includes(value));version=Number(value);continue;}
    cargoRequire(['name','version','source','checksum','dependencies'].includes(key) && !Object.hasOwn(row,key));
    if(key==='dependencies') { if(value==='['){list=value;row.dependencies=null;}else row.dependencies=cargoDependencyList(value); }
    else row[key]=cargoString(value);
  }
  cargoRequire(version!==undefined && list===undefined);const identities=new Set();
  return packages.map(p=>{
    cargoIdentity(p.name,p.version);
    const source=p.source??null, sourceKind=source===null?'local':source===cargoPublicSource?'crates.io':source.startsWith('registry+')?'registry':source.startsWith('git+')?'git':null;
    cargoRequire(sourceKind && (source===null || /^[\x21-\x7e]{1,2048}$/.test(source) && !['git+','registry+'].includes(source)));
    if(sourceKind==='crates.io')cratesIoIdentity(p.name,p.version);
    cargoRequire(['registry','crates.io'].includes(sourceKind)?cargoDigest(p.checksum):p.checksum===undefined);
    const sourceSha256=source===null?null:sha(source), key=JSON.stringify([p.name,p.version,sourceSha256]);cargoRequire(!identities.has(key));identities.add(key);
    return {ecosystem:'Cargo',name:p.name,version:p.version,sourceKind,sourceSha256,declaredSha256:p.checksum??null,dependenciesSha256:sha(JSON.stringify(p.dependencies??[]))};
  });
}
export function validateCargoComponent(c) {
  cargoRequire(c && typeof c==='object' && !Array.isArray(c) && Object.keys(c).sort().join()===["declaredSha256","dependenciesSha256","ecosystem","lockPath","name","sourceKind","sourceSha256","version",...(Object.hasOwn(c,"artifact")?["artifact"]:[])].sort().join());
  cargoRequire(c.ecosystem==='Cargo' && isCargoLockPath(c.lockPath));cargoIdentity(c.name,c.version);cargoRequire(cargoDigest(c.dependenciesSha256));
  cargoRequire(['local','git','registry','crates.io'].includes(c.sourceKind));
  cargoRequire(c.sourceKind==='local'?c.sourceSha256===null:cargoDigest(c.sourceSha256));
  cargoRequire(['registry','crates.io'].includes(c.sourceKind)?cargoDigest(c.declaredSha256):c.declaredSha256===null);
  if(c.sourceKind==='crates.io'){cratesIoIdentity(c.name,c.version);cargoRequire(c.sourceSha256===cargoPublicSourceSha256);}else cargoRequire(c.sourceSha256!==cargoPublicSourceSha256);
  if (Object.hasOwn(c, "artifact")) {
    const a = c.artifact; exact(a, ["path", "sha256", "size", "algorithm", "expectedSha256", "status"]);
    scannerPath(a.path);
    cargoRequire(["registry", "crates.io"].includes(c.sourceKind) && cargoDigest(a.sha256) && Number.isSafeInteger(a.size) && a.size > 0 && a.size <= 2 * 1024 * 1024
      && a.algorithm === "sha256" && a.expectedSha256 === c.declaredSha256 && a.status === (a.sha256 === a.expectedSha256 ? "matched" : "mismatched"));
  }
  return c;
}
export function cargoCycloneDxComponent(c) {
  validateCargoComponent(c);
  return {type:'library','bom-ref':'switchyard:'+sha(JSON.stringify(['Cargo',c.lockPath,c.name,c.version,c.sourceSha256])),name:c.name,version:c.version,
    ...(c.sourceKind==='crates.io'?{purl:`pkg:cargo/${c.name}@${encodeURIComponent(c.version)}`} : {}),properties:[
      {name:'switchyard:ecosystem',value:'Cargo'},{name:'switchyard:lockfile',value:c.lockPath},{name:'switchyard:cargo-source-kind',value:c.sourceKind},
      ...(c.sourceSha256?[{name:'switchyard:declared-source-sha256',value:c.sourceSha256}]:[]),...(c.declaredSha256?[{name:'switchyard:declared-sha256',value:c.declaredSha256}]:[]),
      {name:'switchyard:declared-dependencies-sha256',value:c.dependenciesSha256},{name:'switchyard:cargo-resolution',value:'not-performed'},
      ...(c.artifact ? [{name:'switchyard:artifact-path',value:c.artifact.path},{name:'switchyard:artifact-sha256',value:c.artifact.sha256},{name:'switchyard:artifact-integrity',value:c.artifact.status},{name:'switchyard:artifact-content',value:'not-inspected'}] : [])
    ]};
}

const npmName = value => typeof value === "string" && ![".", ".."].includes(value) && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]{1,128}$/.test(value);
/** Strict literal SemVer; numeric identifiers stay within npm's precise integer range. */
export function parseNpmVersion(value) {
  try {
    const parsed = parseCargoVersion(value);
    if ([...parsed.core, ...parsed.pre.filter(part => /^[0-9]+$/.test(part))].some(part => BigInt(part) > 9007199254740991n)) throw Error();
    return parsed;
  } catch { throw Error("Choose a literal npm SemVer of at most 256 characters with precise numeric identifiers."); }
}
export function compareNpmVersions(left, right) {
  parseNpmVersion(left); parseNpmVersion(right); return compareCargoVersions(left, right);
}
export function npmVersion(value) { try { parseNpmVersion(value); return true; } catch { return false; } }
// Bounded PEP 440 identifiers. Keep literal declarations in the BOM; compare
// identities by normalized numeric and suffix semantics, never lexicographic order.
const pythonVersionPattern = /^v?(?:([0-9]+)!)?([0-9]+(?:\.[0-9]+)*)(?:[-_.]?(alpha|beta|preview|pre|rc|a|b|c)[-_.]?([0-9]+)?)?(?:(?:-([0-9]+))|(?:[-_.]?(post|rev|r)[-_.]?([0-9]+)?))?(?:[-_.]?(dev)[-_.]?([0-9]+)?)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/i;
const pythonInteger = value => value.replace(/^0+(?=[0-9])/, "");
const comparePythonInteger = (a, b) => a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length < b.length ? -1 : 1;
export function parsePypiVersion(value) {
  if (typeof value !== "string" || !value.length || value.length > 128 || !/^[A-Za-z0-9.!+_-]+$/.test(value)) throw Error("Choose a bounded literal Python version without whitespace or controls.");
  const m = pythonVersionPattern.exec(value);
  if (!m) throw Error("Unsupported PEP 440 Python version.");
  const release = m[2].split(".").map(pythonInteger), local = m[10]?.toLowerCase().split(/[-_.]/).map(part => /^[0-9]+$/.test(part) ? [1, pythonInteger(part)] : [0, part]) ?? null;
  if (release.length > 32 || local && local.length > 32) throw Error("Python version segment bound exceeded.");
  const label = m[3]?.toLowerCase(), phase = label ? ({ alpha: 0, a: 0, beta: 1, b: 1, preview: 2, pre: 2, rc: 2, c: 2 })[label] : null;
  const dev = m[8] === undefined ? null : pythonInteger(m[9] ?? "0");
  return { epoch: pythonInteger(m[1] ?? "0"), release, pre: phase === null ? null : [phase, pythonInteger(m[4] ?? "0")], post: m[5] !== undefined || m[6] !== undefined ? pythonInteger(m[5] ?? m[7] ?? "0") : null, dev, local };
}
export function pypiVersionKey(value) {
  const v = parsePypiVersion(value), release = [...v.release];
  while (release.length > 1 && release.at(-1) === "0") release.pop();
  return JSON.stringify([v.epoch, release, v.pre, v.post, v.dev, v.local]);
}
export function comparePypiVersions(left, right) {
  const a = parsePypiVersion(left), b = parsePypiVersion(right), epoch = comparePythonInteger(a.epoch, b.epoch);
  if (epoch) return epoch;
  for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
    const order = comparePythonInteger(a.release[i] ?? "0", b.release[i] ?? "0"); if (order) return order;
  }
  const preRank = v => v.pre ? v.pre[0] : v.post === null && v.dev !== null ? -1 : 3;
  const rank = preRank(a) - preRank(b); if (rank) return Math.sign(rank);
  if (a.pre && b.pre) { const order = comparePythonInteger(a.pre[1], b.pre[1]); if (order) return order; }
  for (const [field, missingFirst] of [["post", true], ["dev", false]]) {
    if (a[field] === null || b[field] === null) { if (a[field] !== b[field]) return (a[field] === null) === missingFirst ? -1 : 1; }
    else { const order = comparePythonInteger(a[field], b[field]); if (order) return order; }
  }
  if (a.local === null || b.local === null) return a.local === b.local ? 0 : a.local === null ? -1 : 1;
  for (let i = 0; i < Math.min(a.local.length, b.local.length); i++) {
    const [at, av] = a.local[i], [bt, bv] = b.local[i];
    if (at !== bt) return at < bt ? -1 : 1;
    const order = at ? comparePythonInteger(av, bv) : av < bv ? -1 : av > bv ? 1 : 0; if (order) return order;
  }
  return Math.sign(a.local.length - b.local.length);
}
export function pypiIdentity(name, version) {
  if (typeof name !== "string" || name.length > 128 || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) throw Error("Unsupported literal Python distribution name.");
  parsePypiVersion(version);
  return { ecosystem: "PyPI", name: name.toLowerCase().replace(/[-_.]+/g, "-"), version };
}
export const isPinnedRequirementsPath = path => typeof path === "string" && /(?:^|\/)requirements(?:[-_.][A-Za-z0-9_-]+)?\.(?:txt|lock)$/i.test(path);
/** A closed metadata subset, never pip, a resolver, includes or index access. */
export function parsePinnedRequirements(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 256 * 1024 || /[\0\v\f]/.test(text) || /\r(?!\n)/.test(text)) throw Error("Unsupported bounded Python requirements input.");
  const lines = text.replace(/\r\n/g, "\n").split("\n"); if (lines.length > 8192) throw Error("Python requirements exceed their line bound.");
  const components = [], names = new Set(); let pending = "";
  for (const raw of lines) {
    let line = raw.replace(/(?:^|\s)#.*$/, "").trim(); if (!line) continue;
    const continued = line.endsWith("\\"); if (continued) line = line.slice(0, -1).trim();
    if (!line || line.includes("\\") || pending.length + line.length > 8192) throw Error("Unsupported Python requirements continuation.");
    pending += (pending ? " " : "") + line;
    if (continued) continue;
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)[ \t]*==[ \t]*([A-Za-z0-9.!+_-]{1,128})(?:[ \t]+((?:--hash=sha256:[a-f0-9]{64})(?:[ \t]+--hash=sha256:[a-f0-9]{64})*))?$/.exec(pending);
    if (!match) throw Error("Requirements outside the exact version-pin/hash subset are unsupported.");
    const identity = pypiIdentity(match[1], match[2]), declaredSha256 = match[3] ? match[3].split(/[ \t]+/).map(value => value.slice(14)).sort() : [];
    if (names.has(identity.name) || declaredSha256.length > 64 || new Set(declaredSha256).size !== declaredSha256.length || components.length >= 4096) throw Error("Duplicate or excessive Python requirements metadata.");
    names.add(identity.name); components.push({ ...identity, declaredSha256 }); pending = "";
  }
  if (pending) throw Error("Unfinished Python requirements continuation.");
  return components;
}
function npmLocationName(location) {
  scannerPath(location);
  const parts = location.split("/"), index = parts.lastIndexOf("node_modules");
  if (parts.includes(".git")) throw Error("Unsupported npm package location.");
  if (index < 0) return null;
  const name = parts.slice(index + 1).join("/");
  if (!npmName(name)) throw Error("Unsupported npm installed name.");
  return name;
}
/** Deliberately bounded declaration subset: one canonical SHA-512 SRI value. */
export function npmArtifactSha512(value) {
  if (typeof value !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return null;
  const encoded = value.slice(7), bytes = Buffer.from(encoded, "base64");
  return bytes.length === 64 && bytes.toString("base64") === encoded ? bytes.toString("hex") : null;
}
const artifactKey = (lockPath, location) => JSON.stringify([lockPath, location]);
export const shieldArtifactReferenceKey = row => row.ecosystem === "Cargo"
  ? JSON.stringify(["Cargo", row.lockPath, row.name, row.version, row.sourceSha256])
  : row.ecosystem === "PyPI" ? JSON.stringify(["PyPI", row.requirementsPath, row.name, row.version]) : artifactKey(row.lockPath, row.location);
function workspaceLink(packages, link, cache) {
  if (!object(link) || link.link !== true || Object.keys(link).some(key => !["link", "resolved"].includes(key)) || typeof link.resolved !== "string") throw Error("Unsupported workspace link.");
  const path = scannerPath(link.resolved);
  if (path.split("/").some(part => part === "node_modules" || part === ".git") || !Object.hasOwn(packages, path)) throw Error("Unsupported local workspace target.");
  if (cache.has(path)) return cache.get(path);
  const metadata = packages[path];
  if (!object(metadata) || (metadata.link !== undefined && metadata.link !== false) || Object.hasOwn(metadata, "resolved") || !npmName(metadata.name) || !npmVersion(metadata.version)) throw Error("Workspace metadata is absent or ambiguous.");
  // Hash declared lock metadata once per target; never open its filesystem
  // location, follow a link or execute lifecycle scripts.
  const result = { metadata, workspace: { path, lockMetadataSha256: sha(JSON.stringify(metadata)) } };
  cache.set(path, result); return result;
}
export function shieldCycloneDxComponent(c) { if(c.ecosystem==="Cargo")return cargoCycloneDxComponent(c); return { type: "library", "bom-ref": "switchyard:" + sha(`${c.ecosystem}\0${c.lockPath??c.requirementsPath}\0${c.location??c.name}\0${c.name}\0${c.version}`), name: c.name, version: c.version,
      ...(c.ecosystem === "PyPI" ? { purl: `pkg:pypi/${c.name}@${encodeURIComponent(c.version.toLowerCase()).replaceAll("!", "%21")}` } : {}),
      ...(c.license ? { licenses: [{ license: { name: c.license } }] } : {}), properties: [
        { name: "switchyard:ecosystem", value: c.ecosystem },
        ...(c.ecosystem === "PyPI" ? [{ name: "switchyard:requirements-file", value: c.requirementsPath }, { name: "switchyard:declared-sha256", value: JSON.stringify(c.declaredSha256) }, { name: "switchyard:python-environment", value: "not-resolved" }] : [{ name: "switchyard:lockfile", value: c.lockPath }, { name: "switchyard:package-location", value: c.location }, { name: "switchyard:installed-as", value: c.installedAs }]),
        ...(c.workspace?[{name:"switchyard:source-kind",value:"workspace-link"},{name:"switchyard:workspace-path",value:c.workspace.path},{name:"switchyard:workspace-lock-metadata-sha256",value:c.workspace.lockMetadataSha256},{name:"switchyard:workspace-source",value:"not-verified"}]:[]),
        ...(c.integritySha256 ? [{ name: "switchyard:integrity-string-sha256", value: c.integritySha256 }] : []),
        ...(c.artifact ? [{ name: "switchyard:artifact-path", value: c.artifact.path }, { name: "switchyard:artifact-sha256", value: c.artifact.sha256 }, ...(c.artifact.algorithm === "sha512" ? [{ name: "switchyard:artifact-observed-sha512", value: c.artifact.observedSha512 }] : []), { name: "switchyard:artifact-integrity", value: c.artifact.status }, { name: "switchyard:artifact-content", value: "not-inspected" }] : [])
      ] }; }
function feed(v) { exact(v, ["id", "path", "sha256"]); return { id: identifier(v.id), path: scannerPath(v.path), sha256: digest(v.sha256) }; }
function indexSource(v) {
  exact(v, ["kind", "path", "objectId", "mode"]);
  if (v.kind !== "git-index" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.objectId ?? "") || /^0+$/.test(v.objectId) || !["100644", "100755"].includes(v.mode)) throw Error("Invalid exact index source declaration.");
  const path = scannerPath(v.path);
  if (shieldReservedPath(path)) throw Error("Nested scanner index aliases are refused.");
  return { kind: "git-index", path, objectId: v.objectId, mode: v.mode };
}
function historySource(v){
  exact(v,["kind","path","commit","objectId","mode","depth"]);
  if(v.kind!=="git-history"||![v.commit,v.objectId].every(value=>typeof value==="string"&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)&&!/^0+$/.test(value))||v.commit.length!==v.objectId.length||!["100644","100755"].includes(v.mode)||!Number.isSafeInteger(v.depth)||v.depth<1||v.depth>6)throw Error("Invalid exact historical source declaration.");
  const path=scannerPath(v.path);if(shieldReservedPath(path)||path.length>384||path.split("/").length>28)throw Error("Historical source paths exceed their exact bounds.");
  return{kind:"git-history",path,commit:v.commit,objectId:v.objectId,mode:v.mode,depth:v.depth};
}
export function validateShieldRequest(v) {
  exact(v, ["schema", "version", "action", "scope", "files", "scanner", "advisory", ...(Object.hasOwn(v ?? {}, "packageArtifacts") ? ["packageArtifacts"] : [])]);
  if (v.schema !== "switchyard-shield-scan/v1" || v.version !== 1 || !shieldActions.includes(v.action) || v.scope !== "reviewed-inputs") throw Error("Unsupported Shield request or scope.");
  const files = array(v.files, 512).map(f => {
    exact(f, ["path", "sha256", "size", ...(Object.hasOwn(f ?? {}, "source") ? ["source"] : [])]);
    if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > 2 * 1024 * 1024) throw Error("Scanner file exceeds its bound.");
    const path = scannerPath(f.path), source = Object.hasOwn(f, "source") ? (f.source?.kind==="git-history"?historySource(f.source):indexSource(f.source)) : undefined;
    if (source ? path !== (source.kind==="git-history"?shieldHistoryPrefix+source.commit+"/":shieldIndexPrefix) + source.path : shieldReservedPath(path)) throw Error("Index inputs require their exact reserved disposable path and original source identity.");
    return { path, sha256: digest(f.sha256), size: f.size, ...(source ? { source } : {}) };
  });
  if (!files.length || files.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024 || new Set(files.map(f => f.path.toLowerCase())).size !== files.length) throw Error("Invalid scanner input inventory.");
  const history=files.filter(file=>file.source?.kind==="git-history");
  if(history.length&&(!["shield_codebase_audit","release_shield"].includes(v.action)||history.length>48||new Set(history.map(file=>file.source.path)).size>8||new Set(history.map(file=>file.source.depth)).size!==1||files.some(file=>file.source?.kind==="git-index")))throw Error("Historical scans require one bounded depth and a separate Codebase Audit or Release scope; mixed index/history requests are not connected.");
  const scanner = feed(v.scanner), advisory = v.advisory === null ? null : feed(v.advisory);
  if (advisory && (advisory.id === scanner.id || advisory.path.toLowerCase() === scanner.path.toLowerCase()) || files.some(f => [scanner.path, advisory?.path].includes(f.path))) throw Error("Ambiguous scanner inputs.");
  let packageArtifacts;
  if (Object.hasOwn(v, "packageArtifacts")) {
    if (!["shield_supply_chain", "release_shield"].includes(v.action)) throw Error("Package artifacts require a supply-chain or release review.");
    const sources = new Map(files.map(f => [f.path, f])), seen = new Set();
    packageArtifacts = array(v.packageArtifacts, 128).map(row => {
      if (row?.ecosystem === "PyPI") {
        exact(row, ["ecosystem", "requirementsPath", "name", "version", "path"]);
        const requirementsPath = scannerPath(row.requirementsPath), path = scannerPath(row.path), { name, version } = pypiIdentity(row.name, row.version);
        const key = shieldArtifactReferenceKey({ ecosystem: "PyPI", requirementsPath: requirementsPath.toLowerCase(), name, version });
        if (name !== row.name || !isPinnedRequirementsPath(requirementsPath) || !sources.has(requirementsPath) || !sources.has(path) || sources.get(path).size === 0 || path === requirementsPath || seen.has(key)) throw Error("Python artifact references require unique exact reviewed pins, normalized names and file bytes.");
        seen.add(key); return { ecosystem: "PyPI", requirementsPath, name, version, path };
      }
      if (row?.ecosystem === "Cargo") {
        exact(row, ["ecosystem", "lockPath", "name", "version", "sourceSha256", "path"]);
        const lockPath = scannerPath(row.lockPath), path = scannerPath(row.path), { name, version } = cargoIdentity(row.name, row.version), sourceSha256 = digest(row.sourceSha256);
        const key = shieldArtifactReferenceKey({ ecosystem: "Cargo", lockPath: lockPath.toLowerCase(), name, version, sourceSha256 });
        if (!isCargoLockPath(lockPath) || !sources.has(lockPath) || !sources.has(path) || sources.get(path).size === 0 || path === lockPath || seen.has(key)) throw Error("Cargo artifact references require unique exact reviewed identities and file bytes.");
        seen.add(key); return { ecosystem: "Cargo", lockPath, name, version, sourceSha256, path };
      }
      exact(row, ["lockPath", "location", "path"]);
      const lockPath = scannerPath(row.lockPath), path = scannerPath(row.path), location = scannerPath(row.location);
      const key = artifactKey(lockPath, location).toLowerCase();
      if (!sources.has(lockPath) || lockPath.split("/").at(-1) !== "package-lock.json" || !sources.has(path) || sources.get(path).size === 0 || path === lockPath || !npmLocationName(location) || seen.has(key)) throw Error("Artifact references require unique exact reviewed npm locations and file bytes.");
      seen.add(key); return { lockPath, location, path };
    });
    if (!packageArtifacts.length || packageArtifacts.some(row => isCargoLockPath(row.path) || isPinnedRequirementsPath(row.path) || row.path.split("/").at(-1) === "package-lock.json" || packageArtifacts.some(other => row.path === (other.lockPath ?? other.requirementsPath)))) throw Error("Artifact content cannot double as a declared manifest.");
  }
  return { schema: v.schema, version: 1, action: v.action, scope: v.scope, files, scanner, advisory, ...(packageArtifacts ? { packageArtifacts } : {}) };
}
function parseRules(bytes) {
  const v = json(bytes); exact(v, ["schema", "version", "engine", "rules", "allowedLicenses"]);
  if (v.schema !== "switchyard-shield-rules/v1" || v.version !== 1 || v.engine !== shieldEngineVersion) throw Error("Unsupported scanner rule feed.");
  const selected = array(v.rules, 32); if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !Object.hasOwn(rules, id))) throw Error("Unsupported or duplicate scanner rule.");
  const allowedLicenses = array(v.allowedLicenses, 128); if (allowedLicenses.some(s => typeof s !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,79}\+?(?: WITH [A-Za-z0-9][A-Za-z0-9.-]{0,79})?$/.test(s) || npmLicenseDeclaration(s)?.expression !== s) || new Set(allowedLicenses.map(s => s.toLowerCase())).size !== allowedLicenses.length) throw Error("Unsupported license policy.");
  return { selected, allowedLicenses };
}
const advisoryIdentityKey = ({ ecosystem, name, version }) => `${ecosystem}:${name}@${ecosystem === "PyPI" ? pypiVersionKey(version) : version}`;
function parseAdvisories(bytes) {
  const v = json(bytes); exact(v, ["schema", "version", "engine", "packages"]);
  if (v.schema !== "switchyard-shield-advisories/v1" || v.version !== 1 || v.engine !== shieldEngineVersion) throw Error("Unsupported advisory feed.");
  const keys = new Set();
  return array(v.packages, 4096).map(p => {
    exact(p, ["ecosystem", "name", "version", "advisories"]);
    let identity;
    if (p.ecosystem === "npm" && npmName(p.name) && npmVersion(p.version)) identity = { ecosystem: "npm", name: p.name, version: p.version };
    else if (p.ecosystem === "PyPI") identity = pypiIdentity(p.name, p.version);
    else if (p.ecosystem === "crates.io") identity = cratesIoIdentity(p.name,p.version);
    else throw Error("Unsupported advisory package identity.");
    const key = advisoryIdentityKey(identity); if (keys.has(key)) throw Error("Duplicate advisory package."); keys.add(key);
    const advisories = array(p.advisories, 32).map(a => { exact(a, ["id", "severity"]); identifier(a.id); if (!["low", "medium", "high", "critical", "unknown"].includes(a.severity)) throw Error("Invalid advisory severity."); return { id: a.id, severity: a.severity }; });
    if (new Set(advisories.map(a => a.id)).size !== advisories.length) throw Error("Duplicate advisory.");
    return { ...identity, advisories };
  });
}

/** Input reader must return only witnessed bytes. Reports contain no source excerpts. */
export async function scanShieldInputs(proposed, { readInput }) {
  const request = validateShieldRequest(proposed), requested = dimensions[request.action], findings = [], gaps = new Set(["repository_scope_unverified"]), inventory = [], components = []; let dependencyManifests = 0;
  const readFeed = async f => { const b = await readInput(f.path, 2 * 1024 * 1024); if (sha(b) !== f.sha256) throw Error("Scanner feed changed."); return b; };
  const policy = parseRules(await readFeed(request.scanner)), advisory = request.advisory ? parseAdvisories(await readFeed(request.advisory)) : [];
  const advisoryByIdentity = new Map(advisory.map(entry => [advisoryIdentityKey(entry), entry]));
  const add = finding => { if (findings.length < 512) findings.push(finding); else gaps.add("finding_limit"); };
  const artifacts = new Map((request.packageArtifacts ?? []).map(row => [shieldArtifactReferenceKey(row), row])), consumedArtifacts = new Set(), artifactDigests = new Map();
  for (const row of artifacts.values()) if (!artifactDigests.has(row.path)) {
    const file = request.files.find(file => file.path === row.path), bytes = await readInput(file.path, file.size);
    if (bytes.length !== file.size || sha(bytes) !== file.sha256) throw Error("Reviewed artifact bytes changed.");
    artifactDigests.set(row.path, { path: file.path, sha256: file.sha256, size: file.size, observedSha512: createHash("sha512").update(bytes).digest("hex") });
  }
  if (artifacts.size) gaps.add("artifact_contents_not_inspected");
  for (const file of request.files) {
    const bytes = await readInput(file.path, file.size); if (bytes.length !== file.size || sha(bytes) !== file.sha256) throw Error("Scanner input changed.");
    inventory.push({ path: file.path, sha256: file.sha256, bytes: file.size, ...(file.source ? { source: file.source } : {}) });
    let text;
    try { text = utf8(bytes); if (text.includes("\0")) throw Error("binary"); } catch { gaps.add("binary_or_non_utf8_input"); continue; }
    const extension = file.path.split(".").at(-1).toLowerCase();
    for (const id of policy.selected) {
      const rule = rules[id]; if (!requested.includes(rule.dimension) || rule.extensions && !rule.extensions.includes(extension)) continue;
      rule.pattern.lastIndex = 0; let match;
      while ((match = rule.pattern.exec(text)) !== null) {
        add({ ruleId: id, dimension: rule.dimension, severity: rule.severity, path: file.path, line: text.slice(0, match.index).split("\n").length, fingerprint: sha(`${id}\0${file.path}\0${file.sha256}\0${match.index}`) });
        if (findings.length >= 512) { gaps.add("finding_limit"); break; }
      }
    }
    if (/(?:^|\/)(?:poetry\.lock|uv\.lock|go\.sum|Gemfile\.lock|yarn\.lock|pnpm-lock\.yaml)$/.test(file.path)) gaps.add("unsupported_dependency_ecosystem");
    if (/(?:^|\/)requirements[^/]*\.(?:txt|lock)$/i.test(file.path) && !isPinnedRequirementsPath(file.path)) gaps.add("unsupported_dependency_ecosystem");
    if (isCargoLockPath(file.path) && requested.includes("sbom")) {
      let declared;
      try { declared=parseCargoLock(text); } catch { gaps.add("unsupported_cargo_lock");continue; }
      dependencyManifests++;gaps.add("cargo_resolution_not_performed");
      if(declared.length){gaps.add("license_metadata");gaps.add("package_source_or_integrity");}
      for(const component of declared){
        if(components.length>=4096)throw Error("Aggregate dependency inventory exceeds its original component bound.");
        const referenceKey = shieldArtifactReferenceKey({ ...component, lockPath: file.path }), reference = artifacts.get(referenceKey);
        if (reference) {
          if (!["registry", "crates.io"].includes(component.sourceKind)) throw Error("Only Cargo registry declarations can compare a package artifact.");
          const observed = artifactDigests.get(reference.path), status = observed.sha256 === component.declaredSha256 ? "matched" : "mismatched";
          component.artifact = { path: observed.path, sha256: observed.sha256, size: observed.size, algorithm: "sha256", expectedSha256: component.declaredSha256, status };
          consumedArtifacts.add(referenceKey);
          if (status === "mismatched") {
            gaps.add("package_artifact_not_verified");
            add({ ruleId: "artifact.integrity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(`artifact.integrity-mismatch\0Cargo\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}\0${component.sourceSha256}\0${observed.path}\0${observed.sha256}`) });
          }
        } else gaps.add("package_artifact_not_verified");
        components.push({...component,lockPath:file.path});
        const known=component.sourceKind==="crates.io"?advisoryByIdentity.get(advisoryIdentityKey(cratesIoIdentity(component.name,component.version))):undefined;
        if(!known)gaps.add("advisory_package_coverage");
        if(known?.advisories.some(a=>a.severity==="unknown"))gaps.add("advisory_severity_unassessed");
        for(const a of known?.advisories??[])add({ruleId:a.id,dimension:"vulnerabilities",severity:a.severity,path:file.path,line:null,fingerprint:sha(`${a.id}\0Cargo\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}\0${component.sourceSha256}`)});
      }
    }
    if (isPinnedRequirementsPath(file.path) && requested.includes("sbom")) {
      let declared;
      try { declared = parsePinnedRequirements(text); } catch { gaps.add("unsupported_python_requirements"); continue; }
      dependencyManifests++; gaps.add("python_environment_not_resolved");
      if (declared.length) { gaps.add("license_metadata"); gaps.add("package_source_or_integrity"); }
      for (const component of declared) {
        if (components.length >= 4096) throw Error("Aggregate dependency inventory exceeds its original component bound.");
        const referenceKey = shieldArtifactReferenceKey({ ...component, requirementsPath: file.path }), reference = artifacts.get(referenceKey);
        if (reference) {
          const observed = artifactDigests.get(reference.path), acceptedSha256 = [...component.declaredSha256];
          const status = !acceptedSha256.length ? "unsupported-integrity" : acceptedSha256.includes(observed.sha256) ? "matched" : "mismatched";
          component.artifact = { path: observed.path, sha256: observed.sha256, size: observed.size, algorithm: "sha256", acceptedSha256, status };
          consumedArtifacts.add(referenceKey);
          if (status !== "matched") gaps.add("package_artifact_not_verified");
          if (status === "mismatched") add({ ruleId: "artifact.integrity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(`artifact.integrity-mismatch\0PyPI\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}\0${observed.path}\0${observed.sha256}`) });
        } else gaps.add("package_artifact_not_verified");
        components.push({ ...component, requirementsPath: file.path });
        const known = advisoryByIdentity.get(advisoryIdentityKey(component));
        if (!known) gaps.add("advisory_package_coverage");
        if (known?.advisories.some(a => a.severity === "unknown")) gaps.add("advisory_severity_unassessed");
        for (const a of known?.advisories ?? []) add({ ruleId: a.id, dimension: "vulnerabilities", severity: a.severity, path: file.path, line: null, fingerprint: sha(`${a.id}\0PyPI\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}`) });
      }
    }
    if (file.path.split("/").at(-1) === "package-lock.json" && requested.includes("sbom")) {
      let lock;
      try { lock = json(bytes); } catch { gaps.add("invalid_npm_lock"); continue; }
      if (!object(lock) || ![2, 3].includes(lock.lockfileVersion) || !object(lock.packages) || Object.keys(lock.packages).length > 4096) { gaps.add("unsupported_npm_lock"); continue; }
      dependencyManifests++;
      const links = new Map(), targets = new Set(), workspaceCache = new Map();
      for (const [location, p] of Object.entries(lock.packages)) if (object(p) && p.link === true) {
        try {
          const installedAs = npmLocationName(location);
          if (!installedAs) throw Error("Unsupported workspace install location.");
          const target = workspaceLink(lock.packages, p, workspaceCache);
          links.set(location, { ...target, installedAs }); targets.add(target.workspace.path);
        } catch { gaps.add("unsupported_npm_package"); }
      }
      for (const [location, raw] of Object.entries(lock.packages)) {
        if (!location) continue;
        if (targets.has(location)) continue;
        const linked = links.get(location), p = linked?.metadata ?? raw;
        let installedAs;
        try { installedAs = npmLocationName(location); } catch { gaps.add("unsupported_npm_package"); continue; }
        if (!installedAs || !object(p) || (raw.link === true && !linked) || (p.link !== undefined && p.link !== false) || !npmVersion(p.version)) { gaps.add("unsupported_npm_package"); continue; }
        const name = p.name ?? installedAs;
        if (!npmName(name)) { gaps.add("unsupported_npm_package"); continue; }
        const license = npmLicenseDeclaration(p.license, policy.allowedLicenses);
        const component = { ecosystem: "npm", name, installedAs, version: p.version, location, lockPath: file.path, license: license?.expression ?? null, integritySha256: !linked && typeof p.integrity === "string" ? sha(p.integrity) : null, ...(linked ? { workspace: linked.workspace } : {}) };
        const reference = artifacts.get(artifactKey(file.path, location));
        if (reference) {
          if (linked) throw Error("Workspace links cannot attest a package artifact.");
          consumedArtifacts.add(artifactKey(file.path, location));
          const observed = artifactDigests.get(reference.path), expectedSha512 = npmArtifactSha512(p.integrity);
          const status = expectedSha512 === null ? "unsupported-integrity" : expectedSha512 === observed.observedSha512 ? "matched" : "mismatched";
          component.artifact = { ...observed, algorithm: "sha512", expectedSha512, status };
          if (status !== "matched") gaps.add("package_artifact_not_verified");
          if (status === "mismatched") add({ ruleId: "artifact.integrity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(`artifact.integrity-mismatch\0${file.path}\0${file.sha256}\0${location}\0${observed.path}\0${observed.sha256}`) });
        } else gaps.add("package_artifact_not_verified");
        if (components.length >= 4096) throw Error("Aggregate dependency inventory exceeds its original component bound.");
        components.push(component);
        const known = advisoryByIdentity.get(advisoryIdentityKey({ ecosystem: "npm", name, version: p.version }));
        if (!known) gaps.add("advisory_package_coverage");
        if (known?.advisories.some(advisory => advisory.severity === "unknown")) gaps.add("advisory_severity_unassessed");
        for (const a of known?.advisories ?? []) add({ ruleId: a.id, dimension: "vulnerabilities", severity: a.severity, path: file.path, line: null, fingerprint: sha(`${a.id}\0${file.path}\0${file.sha256}\0${location}\0${p.version}`) });
        if (!component.license) gaps.add("license_metadata");
        else if (!policy.allowedLicenses.length) gaps.add("license_policy");
        else if (!license.allowed) add({ ruleId: "license.disallowed", dimension: "licenses", severity: "high", path: file.path, line: null, fingerprint: sha(`license\0${file.path}\0${file.sha256}\0${location}\0${component.license}`) });
        if (license?.choice && license.allowed) gaps.add("license_choice_not_selected");
        let registry = false;
        try { const u = new URL(p.resolved); registry = u.protocol === "https:" && u.hostname === "registry.npmjs.org" && !u.username && !u.password && !u.search && !u.hash && npmArtifactSha512(p.integrity) !== null; } catch {}
        if (linked) gaps.add("workspace_source_unverified");
        if (linked || !registry) gaps.add("package_source_or_integrity");
      }
    }
  }
  if (consumedArtifacts.size !== artifacts.size) throw Error("A reviewed artifact reference did not resolve to an exact supported component.");
  if (requested.includes("history")) gaps.add(request.files.some(file=>file.source?.kind==="git-history")?"git_history_partially_scanned":"git_history_not_scanned");
  if (requested.includes("permissions")) gaps.add("source_permissions_not_witnessed");
  if (requested.includes("provenance")) gaps.add("publisher_provenance_not_verified");
  if (requested.includes("isolation")) gaps.add("host_isolation_requires_attestation");
  if (requested.includes("vulnerabilities") && !request.advisory) gaps.add("advisory_feed_missing");
  if (requested.includes("sbom") && dependencyManifests === 0) gaps.add("dependency_manifest_missing");
  const matrix = requested.map(dimension => ({ dimension, status: "incomplete", rules: policy.selected.filter(id => rules[id].dimension === dimension), findings: findings.filter(f => f.dimension === dimension).length }));
  const cycloneDx = { bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
    metadata: { tools: { components: [{ type: "application", name: "switchyard-baseline-scanner", version: "1" }] }, properties: [
      { name: "switchyard:scope", value: request.scope }, { name: "switchyard:repository-scope", value: "unverified" },
      { name: "switchyard:dependency-graph", value: "not-collected" }, { name: "switchyard:publisher-provenance", value: "not-verified" },
      ...inventory.filter(f=>f.path.split("/").at(-1)==="package-lock.json"||isPinnedRequirementsPath(f.path)||isCargoLockPath(f.path)).map(f=>({name:"switchyard:dependency-manifest:"+f.path,value:"sha256:"+f.sha256}))
    ] },
    components: components.map(shieldCycloneDxComponent), compositions: [{ aggregate: "unknown" }]
  };
  const report = { schema: "switchyard-shield-findings/v1", version: 1, engine: shieldEngineVersion, action: request.action, scope: request.scope, requestSha256: sha(JSON.stringify(request)), scanner: request.scanner, advisory: request.advisory, outcome: findings.length ? "failed" : "incomplete", completeness: "incomplete", coverage: matrix, gaps: [...gaps].sort(), inventory, findings, sbom: { schema: "switchyard-lock-inventory/v2", components }, cycloneDx: requested.includes("sbom") ? cycloneDx : null };
  if (Buffer.byteLength(JSON.stringify(report)) > 480 * 1024) throw Error("Scanner report exceeds the retained output bound.");
  return report;
}

export function createShieldFileReader(root) {
  const base = resolve(root);
  return async (path, maximum) => {
    scannerPath(path); if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 2 * 1024 * 1024) throw Error("Invalid scanner read bound.");
    const target = resolve(base, path), rel = relative(base, target); if (!rel || rel.startsWith("../") || isAbsolute(rel)) throw Error("Scanner input escaped its root.");
    let parent = base;
    for (const part of relative(base, dirname(target)).split(/[\\/]/).filter(Boolean)) { parent = resolve(parent, part); if (!(await lstat(parent)).isDirectory() || (await lstat(parent)).isSymbolicLink()) throw Error("Linked scanner input directory."); }
    if (await realpath(base) !== base || await realpath(target) !== target) throw Error("Linked scanner input.");
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true }); if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)) throw Error("Scanner input is not a bounded unlinked file.");
      const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
      while (offset < bytes.length) { const r = await handle.read(bytes, offset, bytes.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead; }
      const after = await handle.stat({ bigint: true });
      if (offset !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.ino !== after.ino) throw Error("Scanner input changed while reading.");
      return bytes.subarray(0, offset);
    } finally { await handle.close(); }
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error("Select one reviewed scanner request.");
    const readInput = createShieldFileReader(await realpath(process.cwd()));
    const request = json(await readInput(scannerPath(process.argv[2]), 128 * 1024));
    process.stdout.write(JSON.stringify(await scanShieldInputs(request, { readInput })));
    // A report is a successful observation even when findings fail its gate.
    // The trusted host, never a zero exit alone, decides the gate outcome.
  } catch { process.stderr.write("The pinned Shield scanner could not verify its exact inputs.\n"); process.exitCode = 78; }
}
