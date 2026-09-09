// Source-assertion test: every CSS file in the Item 3 plan must consume
// --ex-* tokens (either light or shell) instead of hardcoded dark palette literals.
// Brand-literal status colors (rgba danger/success/warning) and box-shadow rgba
// are intentionally exempt — they are semantic colors, not theme tokens.
//
// Files NOT in this list:
//   - shell-tokens.css: token DEFINITION file. Its job is to declare
//     --ex-shell-* values, so it MUST contain hex/rgba literals inside :root.
//   - UAELicensePlate.css: real-world content. Renders an actual UAE license
//     plate — the black/white/Ajman-flag colors ARE the content, not chrome.

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

describe('public account pages use public theme tokens', () => {
  test('MyListings.css does not inherit the dark shell palette', () => {
    const full = path.join(__dirname, '..', '..', '..', 'styles', 'MyListings.css');
    const src = fs.readFileSync(full, 'utf8');

    expect(src).toMatch(/var\(--ex-(page-bg|surface|text)/);
    expect(src).not.toMatch(/var\(--ex-shell-/);
  });
});

// UAELicensePlate.css renders a real UAE license plate — the colors (#000/#fff
// for plate chrome, the Ajman-flag gradient #e91e63/#ff9800/#2196f3/#795548,
// and the SOLD watermark #f00) are the visual content of the plate, not the
// theme chrome. They intentionally do NOT use --ex-* tokens.
describe('UAELicensePlate.css content tokens (exempt from --ex- migration)', () => {
  test('renders plate chrome (#fff / #000) and Ajman flag gradient as content', () => {
    const full = path.join(__dirname, '..', '..', '..', 'styles', 'UAELicensePlate.css');
    const src = fs.readFileSync(full, 'utf8');
    expect(src).toMatch(/background-color:\s*#fff/);
    expect(src).toMatch(/#e91e63.*#ff9800.*#2196f3.*#795548/s);
    expect(src).toMatch(/background-color:\s*#f00/);
  });
});
