// Source-assertion test for app/_layout.tsx. After the user's request to
// remove all 3-line hamburger triggers from mobile, this file is the
// contract: neither the floating top-left trigger nor the menu-outline icon
// exist in the root layout. Future regressions get caught here.

import fs from 'fs';
import path from 'path';

test('app/_layout.tsx does NOT render a SidebarTrigger (no 3-line hamburger)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '_layout.tsx'),
    'utf8'
  );
  // Per the user: "remove the hamburgers completely its not needed on the
  // mobile app for both ios and android." The SidebarTrigger component was
  // added to this file for iOS coverage; the hamburger button inside
  // AndroidTabBar.js was its Android counterpart. Both must be gone.
  expect(src).not.toMatch(/SidebarTrigger/);
  expect(src).not.toMatch(/menu-outline/);
  expect(src).not.toMatch(/Open navigation menu/);
  // Also: don't import the now-unused Sidebar component or its trigger styles.
  expect(src).not.toMatch(/import Sidebar from/);
  expect(src).not.toMatch(/triggerStyles/);
});