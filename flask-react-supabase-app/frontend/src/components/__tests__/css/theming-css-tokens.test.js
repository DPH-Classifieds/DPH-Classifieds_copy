// Source-assertion test: every CSS file in the Item 3 plan must consume
// --ex-* tokens (either light or shell) instead of hardcoded dark palette literals.
// Brand-literal status colors (rgba danger/success/warning) and box-shadow rgba
// are intentionally exempt — they are semantic colors, not theme tokens.

import fs from 'fs';
import path from 'path';

const FILES = [
  'Auth.css',
  'AdminLayout.css',
  'AdminDashboard.css',
  'AdminDealers.css',
  'AdminTools.css',
  'AdminUsers.css',
  'Header.css',
  'HomePage.css',
  'MyListings.css',
  'Plates.css',
  'Bikes.css',
  'CarParts.css',
  'Contact.css',
  'NotFound.css',
  'PostForms.css',
  'Profile.css',
  'ProfileMenu.css',
  'ReportButton.css',
  'SavedListings.css',
  'SearchBar.css',
  'AnnouncementBanner.css',
  'About.css',
  'CreateListing.css',
  'Settings.css',
  'BetaGate.css',
  'AccountSettings.css'
];

describe('CSS files use --ex-* theme tokens (Item 3 web theming)', () => {
  test.each(FILES)('%s references --ex-* (light or shell) tokens', (relPath) => {
    const full = path.join(__dirname, '..', '..', '..', 'styles', relPath);
    const src = fs.readFileSync(full, 'utf8');
    const usesEx = /var\(--ex-/.test(src);
    expect(usesEx).toBe(true);
  });
});
