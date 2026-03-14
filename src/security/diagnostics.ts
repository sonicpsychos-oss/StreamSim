export function redactSecrets(input: unknown): unknown {
  const value = JSON.stringify(input);
  return JSON.parse(
    value
      .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g, "$1[REDACTED]")
      .replace(/(api[_-]?key"?\s*:\s*")[^"]+/gi, "$1[REDACTED]")
  );
}
