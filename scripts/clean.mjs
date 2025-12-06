import { rmSync } from 'node:fs';
try {
  rmSync('dist', { recursive: true, force: true });
} catch {}
