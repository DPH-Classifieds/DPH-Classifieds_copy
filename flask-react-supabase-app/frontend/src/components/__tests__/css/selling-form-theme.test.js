import fs from 'fs';
import path from 'path';

const stylesDir = path.join(__dirname, '..', '..', '..', 'styles');

const readStyle = (name) => fs.readFileSync(path.join(stylesDir, name), 'utf8');

describe('selling forms keep light and dark palettes tokenized', () => {
  test.each([
    ['PostForms.css', '--pf-bg', '--pf-text'],
    ['CreateListing.css', '--cl-bg', '--cl-text'],
  ])('%s defines local palette tokens and a dark override', (file, backgroundToken, textToken) => {
    const source = readStyle(file);

    expect(source).toContain(`${backgroundToken}:`);
    expect(source).toContain(`${textToken}:`);
    expect(source).toMatch(/\.dark\s*\{/);
    expect(source).toMatch(new RegExp(`\\.dark[\\s\\S]*${backgroundToken}:`));
    expect(source).toMatch(new RegExp(`\\.dark[\\s\\S]*${textToken}:`));
  });

  test('shared posting forms do not use the always-dark shell text token', () => {
    expect(readStyle('PostForms.css')).not.toContain('var(--ex-shell-text)');
  });
});
