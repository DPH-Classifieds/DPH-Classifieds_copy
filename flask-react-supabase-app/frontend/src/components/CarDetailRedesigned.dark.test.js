// CSS test: when the toggle-driven .dark class is set on <html>, the
// CarDetailRedesigned --cd-* tokens must resolve to dark values (mirroring
// the prefers-color-scheme: dark block). This pins the visual contract for
// the detail page so future refactors of CarDetailRedesigned.css cannot
// silently drop dark-mode support for users who explicitly toggle it.

import fs from 'fs';
import path from 'path';

test('CarDetailRedesigned.css defines a .dark :root block with the same --cd-* dark values as the prefers-color-scheme block', () => {
  const cssPath = path.join(__dirname, 'CarDetailRedesigned.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // 1. The prefers-color-scheme: dark block must still exist.
  expect(css).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);

  // 2. A .dark :root block must also exist (the new addition).
  expect(css).toMatch(/\.dark\s+:root/);

  // 3. Spot-check that the .dark block contains at least one dark hex value
  //    from the prefers-color-scheme block. If a refactor drops the values,
  //    this test catches it.
  expect(css).toMatch(/\.dark\s+:root[\s\S]*?--cd-color-background-primary:\s*#0a0a0a/);
});
