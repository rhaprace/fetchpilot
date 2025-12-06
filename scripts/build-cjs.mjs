import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

const esm = readFileSync(join(distDir, 'index.js'), 'utf8');
const cjs = `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nconst m = require('./index.js');\nmodule.exports = m;\n`;

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'index.cjs'), cjs);