// Pure 4x5 colour-matrix math for the photo editor's adjustments + filters.
// A Skia colour matrix is 20 numbers (4 rows RGBA × 5 cols), applied to
// normalised [0,1] colour: out = M · [r,g,b,a,1]. Keeping this pure (no Skia
// import) makes it unit-testable and reusable for both the live preview and the
// offscreen bake. See colorMatrix.test.js.

export const IDENTITY = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

// Compose two matrices so the result applies `first` then `second`
// (second · first), treating each as a 4x4 linear part + a translation column.
export function multiply(second, first) {
  const out = new Array(20).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += second[row * 5 + k] * first[k * 5 + col];
      }
      // The 5th column also carries `second`'s own translation.
      if (col === 4) sum += second[row * 5 + 4];
      out[row * 5 + col] = sum;
    }
  }
  return out;
}

// brightness: 1 = neutral, multiplies RGB.
export function brightnessMatrix(b) {
  return [
    b, 0, 0, 0, 0,
    0, b, 0, 0, 0,
    0, 0, b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

// contrast: 1 = neutral. out = (in - 0.5) * c + 0.5.
export function contrastMatrix(c) {
  const t = 0.5 * (1 - c);
  return [
    c, 0, 0, 0, t,
    0, c, 0, 0, t,
    0, 0, c, 0, t,
    0, 0, 0, 1, 0,
  ];
}

// saturation: 1 = neutral, 0 = greyscale. Luminance-preserving (Rec. 709).
export function saturationMatrix(s) {
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const sr = (1 - s) * lr;
  const sg = (1 - s) * lg;
  const sb = (1 - s) * lb;
  return [
    sr + s, sg,     sb,     0, 0,
    sr,     sg + s, sb,     0, 0,
    sr,     sg,     sb + s, 0, 0,
    0,      0,      0,      1, 0,
  ];
}

// Named look presets. Adjustments (brightness/contrast/saturation) are layered
// on top of the chosen preset.
export const FILTERS = ['None', 'Mono', 'Sepia', 'Warm', 'Cool', 'Vivid'];

function presetMatrix(name) {
  switch (name) {
    case 'Mono':
      return saturationMatrix(0);
    case 'Sepia':
      return [
        0.393, 0.769, 0.189, 0, 0,
        0.349, 0.686, 0.168, 0, 0,
        0.272, 0.534, 0.131, 0, 0,
        0,     0,     0,     1, 0,
      ];
    case 'Warm':
      return [
        1.06, 0, 0, 0, 0.02,
        0,    1, 0, 0, 0,
        0,    0, 0.94, 0, 0,
        0,    0, 0, 1, 0,
      ];
    case 'Cool':
      return [
        0.94, 0, 0,    0, 0,
        0,    1, 0,    0, 0,
        0,    0, 1.06, 0, 0.02,
        0,    0, 0,    1, 0,
      ];
    case 'Vivid':
      return multiply(contrastMatrix(1.1), saturationMatrix(1.4));
    case 'None':
    default:
      return IDENTITY;
  }
}

// Build the final matrix for the given edit state. Order: preset first, then
// saturation, contrast, brightness on top.
export function buildMatrix({ brightness = 1, contrast = 1, saturation = 1, preset = 'None' } = {}) {
  let m = presetMatrix(preset);
  m = multiply(saturationMatrix(saturation), m);
  m = multiply(contrastMatrix(contrast), m);
  m = multiply(brightnessMatrix(brightness), m);
  return m;
}

// True when the edit state is a no-op, so callers can skip the (costly) Skia
// bake entirely and keep the original bytes.
export function isNeutral({ brightness = 1, contrast = 1, saturation = 1, preset = 'None' } = {}) {
  return brightness === 1 && contrast === 1 && saturation === 1 && (preset === 'None' || !preset);
}
