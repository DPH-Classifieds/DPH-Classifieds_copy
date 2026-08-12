// Mock all TF.js / model modules before any imports
jest.mock('nsfwjs');
jest.mock('@tensorflow-models/blazeface');
jest.mock('@tensorflow/tfjs', () => ({}));
jest.mock('@tensorflow/tfjs-backend-webgl', () => ({}));

import * as nsfwjs from 'nsfwjs';
import * as blazeface from '@tensorflow-models/blazeface';
import { moderateImage, _resetModels } from './imageModeration';

// Minimal File stub — JSDOM doesn't provide a real File with type
function makeFile(name = 'car.jpg', type = 'image/jpeg') {
  return new File(['x'], name, { type });
}

// Stub URL.createObjectURL / revokeObjectURL
beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = jest.fn();
  // Stub Image so fileToImageElement resolves immediately
  global.Image = class {
    set src(_) { setTimeout(() => this.onload?.(), 0); }
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetModels();
});

function mockModels({ porn = 0, hentai = 0, sexy = 0, faces = [] } = {}) {
  nsfwjs.load.mockResolvedValue({
    classify: jest.fn().mockResolvedValue([
      { className: 'Neutral', probability: 1 - porn - hentai - sexy },
      { className: 'Porn', probability: porn },
      { className: 'Hentai', probability: hentai },
      { className: 'Sexy', probability: sexy },
      { className: 'Drawing', probability: 0 },
    ]),
  });
  blazeface.load.mockResolvedValue({
    estimateFaces: jest.fn().mockResolvedValue(faces),
  });
}

test('clean image is not blocked', async () => {
  mockModels();
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(false);
  expect(result.reasons).toEqual([]);
});

test('porn > 0.85 is blocked as nudity', async () => {
  mockModels({ porn: 0.90 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
});

test('hentai > 0.85 is blocked as nudity', async () => {
  mockModels({ hentai: 0.90 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
});

test('sexy > 0.95 is blocked as nudity', async () => {
  mockModels({ sexy: 0.97 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
});

test('sexy in the suggestive range (<= 0.95) is NOT blocked (car false-positive guard)', async () => {
  mockModels({ sexy: 0.80 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(false);
});

test('face with probability > 0.85 is blocked', async () => {
  mockModels({ faces: [{ probability: [0.95] }] });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('face');
});

test('face with probability <= 0.85 is NOT blocked', async () => {
  mockModels({ faces: [{ probability: [0.80] }] });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(false);
});

test('face AND nudity returns both reasons deduplicated', async () => {
  mockModels({ porn: 0.90, faces: [{ probability: [0.95] }] });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
  expect(result.reasons).toContain('face');
  expect(result.reasons.length).toBe(2);
});

test('models load once and are reused across calls', async () => {
  mockModels();
  await moderateImage(makeFile());
  await moderateImage(makeFile());
  expect(nsfwjs.load).toHaveBeenCalledTimes(1);
  expect(blazeface.load).toHaveBeenCalledTimes(1);
});
