const secretPatterns = [
  /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{8,}\b/g,
  /\b(?:sk|rk)_[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{8,}\b/g,
  /(?:password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi
];

/** Removes common credential/DSN forms before data enters receipts or audit logs. */
export function redactText(value: string): string {
  return secretPatterns.reduce((result, pattern) => result.replace(pattern, "[REDACTED]"), value);
}

export function redactRecord(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/password|secret|token|credential|api[_-]?key/i.test(key)) return [key, "[REDACTED]"];
    if (typeof item === "string") return [key, redactText(item)];
    if (Array.isArray(item)) return [key, item.map((entry) => typeof entry === "string" ? redactText(entry) : entry)];
    return [key, item];
  }));
}

/** Untrusted content may be reported, but never interpreted as authority or executable policy. */
export function untrustedSummary(value: string, maximumLength = 512): string {
  return redactText(value).replace(/[\r\n\t]+/g, " ").slice(0, maximumLength);
}
