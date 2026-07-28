import {
  IDENTITY,
  multiply,
  brightnessMatrix,
  contrastMatrix,
  saturationMatrix,
  buildMatrix,
  isNeutral,
} from '../colorMatrix';

// Apply a 4x5 matrix to a normalised [r,g,b,a] colour.
const apply = (m, [r, g, b, a]) => {
  const px = [r, g, b, a, 1];
  const out = [];
  for (let row = 0; row < 4; row++) {
    let sum = 0;
    for (let c = 0; c < 5; c++) sum += m[row * 5 + c] * px[c];
    out.push(sum);
  }
  return out;
};

const close = (x, y) => Math.abs(x - y) < 1e-6;

test('identity leaves a colour unchanged', () => {
  const c = [0.2, 0.4, 0.6, 1];
  expect(apply(IDENTITY, c)).toEqual(c);
});

test('brightness scales RGB, keeps alpha', () => {
  const [r, g, b, a] = apply(brightnessMatrix(1.5), [0.2, 0.4, 0.6, 1]);
  expect(close(r, 0.3)).toBe(true);
  expect(close(g, 0.6)).toBe(true);
  expect(close(b, 0.9)).toBe(true);
  expect(close(a, 1)).toBe(true);
});

test('contrast pivots around 0.5', () => {
  // A mid-grey pixel is unchanged by any contrast.
  const [r] = apply(contrastMatrix(2), [0.5, 0.5, 0.5, 1]);
  expect(close(r, 0.5)).toBe(true);
  // Below mid-grey darkens.
  const [d] = apply(contrastMatrix(2), [0.4, 0.4, 0.4, 1]);
  expect(d < 0.4).toBe(true);
});

test('saturation 0 collapses to luminance (grey)', () => {
  const [r, g, b] = apply(saturationMatrix(0), [0.2, 0.4, 0.6, 1]);
  const lum = 0.2126 * 0.2 + 0.7152 * 0.4 + 0.0722 * 0.6;
  expect(close(r, lum)).toBe(true);
  expect(close(g, lum)).toBe(true);
  expect(close(b, lum)).toBe(true);
});

test('multiply(second, first) applies first then second', () => {
  // brightness 2 then brightness 0.5 == identity on RGB.
  const m = multiply(brightnessMatrix(0.5), brightnessMatrix(2));
  const [r] = apply(m, [0.3, 0, 0, 1]);
  expect(close(r, 0.3)).toBe(true);
});

test('buildMatrix neutral state equals identity behaviour', () => {
  const m = buildMatrix({});
  const c = [0.25, 0.5, 0.75, 1];
  const out = apply(m, c);
  out.forEach((v, i) => expect(close(v, c[i])).toBe(true));
});

test('isNeutral guards the bake fast-path', () => {
  expect(isNeutral({})).toBe(true);
  expect(isNeutral({ brightness: 1, contrast: 1, saturation: 1, preset: 'None' })).toBe(true);
  expect(isNeutral({ preset: 'Mono' })).toBe(false);
  expect(isNeutral({ brightness: 1.1 })).toBe(false);
});
