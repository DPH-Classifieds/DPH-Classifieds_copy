import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const buildDir = join(process.cwd(), 'build', 'static', 'js');
const files = (await readdir(buildDir))
  .filter((file) => file.endsWith('.js'))
  .map(async (file) => ({ file, bytes: (await stat(join(buildDir, file))).size }));
const sizes = (await Promise.all(files)).sort((a, b) => b.bytes - a.bytes);
const main = sizes.find(({ file }) => file.startsWith('main.'));
const largest = sizes[0];

if (!main || !largest) {
  throw new Error('No production JavaScript bundle was found. Run npm run build first.');
}

console.log(`main bundle: ${(main.bytes / 1024).toFixed(1)} KiB`);
console.log(`largest JavaScript asset: ${largest.file} (${(largest.bytes / 1024).toFixed(1)} KiB)`);
console.log('largest assets:');
for (const asset of sizes.slice(0, 5)) {
  console.log(`  ${asset.file}: ${(asset.bytes / 1024).toFixed(1)} KiB`);
}

const maxInitialBytes = 350 * 1024;
const maxAssetBytes = 1_500 * 1024;
const failures = [];
if (main.bytes > maxInitialBytes) {
  failures.push(`main bundle exceeds ${(maxInitialBytes / 1024).toFixed(0)} KiB`);
}
if (largest.bytes > maxAssetBytes) {
  failures.push(`largest JavaScript asset exceeds ${(maxAssetBytes / 1024).toFixed(0)} KiB`);
}

if (failures.length) {
  throw new Error(failures.join('; '));
}
