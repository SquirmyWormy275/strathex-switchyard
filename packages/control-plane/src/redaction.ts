const secretPatterns = [
  /\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g,
  /\b(?:sk|rk)[_-](?:proj-|ant-)?[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s"']+/gi
];

const sensitiveKey = /(?:^|[_-])(password|passwd|secret|token|credential|api[_-]?key|authorization|cookie|client[_-]?secret|private[_-]?key|access[_-]?token|refresh[_-]?token)(?:$|[_-])/i;
const maxDepth = 8;
const maxNodes = 2_048;
const maxArrayItems = 1_024;

/** Removes common credential/DSN forms before data enters receipts or audit logs. */
export function redactText(value: string): string {
  return secretPatterns.reduce((result, pattern) => result.replace(pattern, "[REDACTED]"), value);
}

export function redactRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number, key?: string): unknown => {
    nodes += 1;
    if (nodes > maxNodes) return "[REDACTED:LIMIT]";
    if (key && sensitiveKey.test(key)) return "[REDACTED]";
    if (typeof item === "string") return redactText(item);
    if (item === null || typeof item !== "object") return item;
    if (depth >= maxDepth) return "[REDACTED:DEPTH]";
    if (seen.has(item)) return "[REDACTED:CYCLE]";
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, maxArrayItems).map((entry) => visit(entry, depth + 1));
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) return "[REDACTED:UNSUPPORTED]";
    return Object.fromEntries(Object.entries(item).map(([childKey, child]) => [childKey, visit(child, depth + 1, childKey)]));
  };
  return visit(value, 0) as Readonly<Record<string, unknown>>;
}

/** Untrusted content may be reported, but never interpreted as authority or executable policy. */
export function untrustedSummary(value: string, maximumLength = 512): string {
  return redactText(value).replace(/[\r\n\t]+/g, " ").slice(0, maximumLength);
}
