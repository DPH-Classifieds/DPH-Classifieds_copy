import { mapLegacyFocalPointToCrop } from './cropUtils';

describe('mapLegacyFocalPointToCrop', () => {
  test('center focal point maps to centered crop', () => {
    const out = mapLegacyFocalPointToCrop({ focal_x: 50, focal_y: 50 });
    expect(out).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  test('top-left focal point shifts crop towards top-left', () => {
    const out = mapLegacyFocalPointToCrop({ focal_x: 0, focal_y: 0 });
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeLessThan(0);
  });

  test('bottom-right focal point shifts crop towards bottom-right', () => {
    const out = mapLegacyFocalPointToCrop({ focal_x: 100, focal_y: 100 });
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeGreaterThan(0);
  });

  test('zoom defaults to 1 when missing', () => {
    expect(mapLegacyFocalPointToCrop({ focal_x: 50, focal_y: 50 }).zoom).toBe(1);
  });

  test('zoom passes through when provided', () => {
    expect(mapLegacyFocalPointToCrop({ focal_x: 50, focal_y: 50, zoom: 1.7 }).zoom).toBe(1.7);
  });

  test('handles missing focal coordinates by centering', () => {
    expect(mapLegacyFocalPointToCrop({})).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  test('clamps absurd focal points to range', () => {
    const tooHigh = mapLegacyFocalPointToCrop({ focal_x: 200, focal_y: -50 });
    expect(tooHigh.x).toBeLessThanOrEqual(50);
    expect(tooHigh.y).toBeGreaterThanOrEqual(-50);
  });
});
