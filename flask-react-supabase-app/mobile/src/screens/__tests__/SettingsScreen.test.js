import fs from 'fs';
import path from 'path';

test('SettingsScreen.js does not import the legacy COLORS constant', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'profile', 'SettingsScreen.js'), 'utf8');
  expect(src).not.toMatch(/import\s*\{[^}]*\bCOLORS\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/constants\/theme['"]/);
  expect(src).toMatch(/useTheme\s*\(\s*\)/);
});
