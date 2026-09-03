// Source-assertion test: each migrated JSX file should either reference
// --ex-* tokens inline (or via themeClasses helpers) or import the
// shell-tokens stylesheet that defines them. Both prove the file is
// theme-aware after the Item 3 migration.

import fs from 'fs';
import path from 'path';

const FILES = [
  'About.js',
  'AccountSettings.js',
  'AnnouncementBanner.jsx',
  'BetaGate.js',
  'CarParts.js',
  'Contact.js',
  'CreateListing.jsx',
  'HomePage.js',
  'MyListings.js',
  'PostBike.js',
  'PostCar.js',
  'PostCarParts.js',
  'PostPlate.js',
  'PrivacyPolicy.js',
  'Profile.js',
  'ProfileMenu.js',
  'ReportBugButton.jsx',
  'SavedListingToggleButton.jsx',
  'SavedListingsNotice.jsx',
  'Settings.js',
  'TermsOfUse.js',
  'AdminLayout.js',
  'AdminHeader.js',
  'AdminSidebar.js',
  'AdminRoute.jsx',
  'DealerLayout.jsx',
  'DealerSidebar.jsx',
  'ImageLightbox.jsx',
  'RenewListing.jsx',
  'CookieBanner.jsx',
  'ui/button.jsx',
  'ui/button.tsx',
  'ui/hover-footer.jsx',
  'ui/otp-verify.tsx',
  'ui/dashboard/EmptyState.jsx',
  'ui/dashboard/GlassCard.jsx',
  'ui/dashboard/KpiTile.jsx',
  'ui/dashboard/SegmentedControl.jsx',
  'ui/dashboard/TrendChart.jsx'
];

describe('JSX files are theme-aware (Item 3 web theming)', () => {
  test.each(FILES)('%s uses --ex-* tokens or imports shell-tokens.css', (relPath) => {
    const full = path.join(__dirname, '..', '..', relPath);
    const src = fs.readFileSync(full, 'utf8');
    const usesInlineToken = /var\(--ex-/.test(src);
    const importsShellTokens = /shell-tokens\.css/.test(src);
    const importsExploreTokens = /ExplorePage\.css/.test(src);
    const usesThemeClasses = /from\s+['"]\.\.\/lib\/themeClasses['"]/.test(src);
    const isOk = usesInlineToken || importsShellTokens || importsExploreTokens || usesThemeClasses;
    expect(isOk).toBe(true);
  });
});
