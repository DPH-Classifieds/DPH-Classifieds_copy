// CSS test: the listing detail pages (CarDetail, Part/Plate/BikeDetailRedesigned,
// RedditListingDetail — all share CarDetailRedesigned.css) must follow the
// SITE theme toggle, not the OS setting. The site defaults to light and flips
// .dark on <html> via ThemeContext, so:
//   1. No prefers-color-scheme block may drive the --cd-* tokens (an OS-dark
//      user in site-light mode must still get the light detail page).
//   2. A working `.dark` (on <html> itself — NOT the impossible `.dark :root`
//      descendant selector) must carry the dark token values.

import fs from 'fs';
import path from 'path';

test('CarDetailRedesigned.css is toggle-driven: no OS media query, working .dark tokens', () => {
  const cssPath = path.join(__dirname, 'CarDetailRedesigned.css');
  // Strip comments so prose describing a selector can't satisfy the matchers.
  const css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  // 1. The OS-level query must NOT drive the detail theme.
  expect(css).not.toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);

  // 2. The dead `.dark :root` descendant selector must be gone — :root IS
  //    <html>, so it can never descend from .dark and the rule never applied.
  expect(css).not.toMatch(/\.dark\s+:root/);

  // 3. A `.dark` block on the <html> element itself must define the dark tokens.
  expect(css).toMatch(/\.dark\s*\{[\s\S]*?--cd-color-background-primary:\s*#0a0a0a/);
  expect(css).toMatch(/\.dark\s*\{[\s\S]*?--cd-color-text-primary:\s*#ffffff/);

  // 4. Light defaults stay on :root so light mode is fully specified.
  expect(css).toMatch(/:root\s*\{[\s\S]*?--cd-color-background-primary:\s*#ffffff/);
});
