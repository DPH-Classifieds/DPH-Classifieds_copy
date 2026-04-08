const fs = require('fs');
const path = require('path');

const packageDir = path.join(
  __dirname,
  '..',
  'node_modules',
  '@mediapipe',
  'tasks-vision'
);
const bundlePath = path.join(packageDir, 'vision_bundle.mjs');
const mapPath = path.join(packageDir, 'vision_bundle_mjs.js.map');

if (!fs.existsSync(bundlePath)) {
  process.exit(0);
}

if (!fs.existsSync(mapPath)) {
  const sourceMap = {
    version: 3,
    file: 'vision_bundle.mjs',
    sources: [],
    sourcesContent: [],
    names: [],
    mappings: ''
  };

  fs.writeFileSync(mapPath, `${JSON.stringify(sourceMap, null, 2)}\n`);
}
