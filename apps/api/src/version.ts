import { readFileSync } from 'node:fs';

/** Reads the version from apps/api/package.json (works from both src/ and dist/). */
export function readVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}
