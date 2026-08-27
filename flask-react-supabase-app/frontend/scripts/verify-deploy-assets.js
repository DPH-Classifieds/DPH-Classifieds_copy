#!/usr/bin/env node
// Run after every deploy: catches the exact failure mode that took the site
// down 3 times on 2026-08-27 — a static JS/CSS chunk silently served as the
// SPA-fallback index.html (wrong content-type) and cached immutably for a
// year at the edge. A rewrite/header misconfig let that happen once; this
// is the safety net so it's caught in seconds instead of by users.
//
// Usage: node scripts/verify-deploy-assets.js [site-url]

const site = process.argv[2] || 'https://www.dphclassifieds.com';

async function main() {
  const manifestRes = await fetch(`${site}/asset-manifest.json`);
  if (!manifestRes.ok) {
    console.error(`Could not fetch asset-manifest.json: HTTP ${manifestRes.status}`);
    process.exit(2);
  }
  const manifest = await manifestRes.json();
  const assets = [...new Set(Object.values(manifest.files || {}).filter((f) => f.startsWith('/static/')))];

  const results = await Promise.all(
    assets.map(async (path) => {
      const res = await fetch(`${site}${path}`, { method: 'GET' });
      const contentType = res.headers.get('content-type') || '';
      const expectHtml = path.endsWith('.js') || path.endsWith('.css');
      const isBroken = expectHtml && contentType.includes('text/html');
      return { path, contentType, isBroken };
    })
  );

  const broken = results.filter((r) => r.isBroken);

  console.log(`Checked ${results.length} static assets referenced by the live build.`);
  if (broken.length === 0) {
    console.log('All clean — no asset is serving the SPA fallback.');
    process.exit(0);
  }

  console.error(`\n${broken.length} asset(s) are poisoned (serving text/html instead of the real file):`);
  for (const b of broken) {
    console.error(`  ${site}${b.path}  ->  ${b.contentType}`);
  }
  console.error('\nThese are cached immutable for a year at the CDN edge — purge each URL manually');
  console.error('(Cloudflare: Caching -> Custom Purge -> By URL) and, if unrelated, redeploy so a');
  console.error("code change to that chunk's source gets it a fresh hash.");
  process.exit(1);
}

main().catch((err) => {
  console.error('verify-deploy-assets failed:', err.message);
  process.exit(2);
});
