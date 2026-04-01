import * as esbuild from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = pkg.version;

fs.mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/agent.js',
  banner: {
    js: `// CODEPILOT_AGENT_VERSION=${version}`,
  },
});

console.log(`Built dist/agent.js (v${version})`);
