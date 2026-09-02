import fs from 'fs';
import path from 'path';

test('Input.js reads colors from useTheme() instead of the static COLORS constant', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'Input.js'), 'utf8');
  expect(src).not.toMatch(/import\s*\{[^}]*\bCOLORS\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/constants\/theme['"]/);
  expect(src).toMatch(/useTheme\s*\(\s*\)/);
});
