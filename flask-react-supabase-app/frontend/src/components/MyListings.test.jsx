import fs from 'fs';
import path from 'path';

test('MyListings.js does not hardcode #8bd6b4 or rgba(255,255,255,*) in inline JSX styles', () => {
  const src = fs.readFileSync(path.join(__dirname, 'MyListings.js'), 'utf8');
  // The listing-limit progress bar and "limit reached" labels previously used
  // hardcoded mint/white literals; they should now reference theme tokens.
  expect(src).not.toMatch(/'#8bd6b4'/);
  expect(src).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\.[16]\)/);
});
