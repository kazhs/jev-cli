import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  entry: { cli: 'src/cli/main.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  define: { __JEV_VERSION__: JSON.stringify(version) },
});
