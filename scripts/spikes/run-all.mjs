// npm run spikes            → free, read-only spikes only (usage)
// npm run spikes -- --spend → also the spikes that spend generation credits / AI tokens
import { spawnSync } from 'node:child_process';
const spend = process.argv.includes('--spend');
const ts = (f, ...a) => ['node', ['--conditions=react-server', '--import', 'tsx', `scripts/spikes/${f}`, ...a]];
const steps = [
  ['00 usage (free)', ['node', ['scripts/spikes/00-usage.mjs']]],
  ...(spend ? [
    ['01 text_to_image draft (1 credit)', ts('01-t2i.mts', '--model', 'auto:economy_fast')],
    ['02 cutout + image_to_image (9 credits)', ts('02-i2i.mts', '--model', 'nano-banana-2-edit')],
    ['03 AI Vision scene DNA + QA', ts('03-vision.mts', '--uri', 'https://res.cloudinary.com/demo/image/upload/sample.jpg')],
  ] : []),
];
for (const [name, [cmd, args]] of steps) {
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!spend) console.log('\n(credit-spending spikes skipped; pass --spend to run them)');
