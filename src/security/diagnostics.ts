const SECRET_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g,
  /(api[_-]?key"?\s*:\s*")[^"]+/gi,
  /(authorization"?\s*:\s*")[^"]+/gi,
  /(token"?\s*:\s*")[^"]+/gi
];

export function redactSecrets(input: unknown): unknown {
  const value = JSON.stringify(input);
  const redacted = SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "$1[REDACTED]"), value);

  return JSON.parse(redacted, (_key, parsedValue) => {
    if (typeof parsedValue === "string" && parsedValue.length > 1024) {
      return `${parsedValue.slice(0, 1024)}...[TRUNCATED]`;
    }
    return parsedValue;
  });
}
