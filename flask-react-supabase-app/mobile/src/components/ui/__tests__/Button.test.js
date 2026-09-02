jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn() }));

import fs from 'fs';
import path from 'path';

test('Button.js reads colors from useTheme() instead of the static COLORS constant', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'Button.js'), 'utf8');
  // Migration contract: every screen/component in the rollout must drop the
  // `import { ... COLORS ... } from '../../constants/theme'` line and pull
  // colors from useTheme() at render time. A regression to the static import
  // breaks the toggle.
  expect(src).not.toMatch(/import\s*\{[^}]*\bCOLORS\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/constants\/theme['"]/);
  expect(src).toMatch(/useTheme\s*\(\s*\)/);
});
