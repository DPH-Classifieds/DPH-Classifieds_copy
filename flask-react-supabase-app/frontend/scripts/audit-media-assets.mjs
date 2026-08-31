import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const DEFAULT_MAX_BYTES = 1024 * 1024;

export async function collectMediaFiles(rootDirs) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) return;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(target);
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(target);
    }));
  }
  await Promise.all(rootDirs.map((directory) => visit(directory)));
  return files.sort();
}

export async function auditMediaFiles(files, maxBytes = DEFAULT_MAX_BYTES) {
  const records = await Promise.all(files.map(async (file) => {
    const [buffer, stats] = await Promise.all([fs.readFile(file), fs.stat(file)]);
    return {
      file,
      bytes: stats.size,
      hash: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  }));
  const oversized = records.filter((record) => record.bytes > maxBytes);
  const byHash = new Map();
  records.forEach((record) => {
    const matches = byHash.get(record.hash) || [];
    matches.push(record.file);
    byHash.set(record.hash, matches);
  });
  const duplicates = [...byHash.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([hash, matches]) => ({ hash, files: matches }));
  return { records, oversized, duplicates };
}

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const maxBytes = Number(process.env.MEDIA_MAX_BYTES || DEFAULT_MAX_BYTES);
const roots = (process.env.MEDIA_AUDIT_ROOTS || 'public,src/assets')
  .split(',')
  .map((root) => path.resolve(projectRoot, root.trim()));
const files = await collectMediaFiles(roots);
const result = await auditMediaFiles(files, maxBytes);
const relative = (file) => path.relative(projectRoot, file);

console.log(`Media audit: ${result.records.length} image assets, max ${maxBytes} bytes`);
if (result.oversized.length) {
  console.error('Oversized assets:');
  result.oversized.forEach((record) => console.error(`- ${relative(record.file)} (${record.bytes} bytes)`));
}
if (result.duplicates.length) {
  console.error('Exact duplicate hashes:');
  result.duplicates.forEach(({ hash, files: matches }) => {
    console.error(`- ${hash}`);
    matches.forEach((file) => console.error(`  ${relative(file)}`));
  });
}
if (!result.oversized.length && !result.duplicates.length) console.log('No oversized assets or exact duplicate hashes found.');
process.exitCode = result.oversized.length || result.duplicates.length ? 1 : 0;
