import { fitContain, computeCropRect, defaultBox } from '../cropGeometry';

test('fitContain letterboxes a wide image in a square area', () => {
  const d = fitContain({ width: 2000, height: 1000 }, { width: 300, height: 300 });
  expect(d.width).toBe(300);
  expect(d.height).toBe(150);
  expect(d.x).toBe(0);
  expect(d.y).toBe(75); // centred vertically
  expect(d.scale).toBeCloseTo(0.15);
});

test('computeCropRect maps a full box to the whole source', () => {
  const source = { width: 2000, height: 1000 };
  const imgDisplay = fitContain(source, { width: 300, height: 300 });
  const rect = computeCropRect({ box: imgDisplay, imgDisplay, source });
  expect(rect).toEqual({ originX: 0, originY: 0, width: 2000, height: 1000 });
});

test('computeCropRect maps a centre-half box to centre source pixels', () => {
  const source = { width: 2000, height: 1000 };
  const imgDisplay = fitContain(source, { width: 300, height: 300 }); // {x:0,y:75,w:300,h:150}
  // A box covering the middle horizontal half of the displayed image.
  const box = { x: 75, y: 75, width: 150, height: 150 };
  const rect = computeCropRect({ box, imgDisplay, source });
  expect(rect.originX).toBe(500); // 75px / 0.15 scale
  expect(rect.originY).toBe(0);
  expect(rect.width).toBe(1000);
  expect(rect.height).toBe(1000); // clamped to source height
});

test('computeCropRect clamps a box dragged past the edge', () => {
  const source = { width: 1000, height: 1000 };
  const imgDisplay = { x: 0, y: 0, width: 200, height: 200 };
  const box = { x: 150, y: 150, width: 100, height: 100 }; // spills past right/bottom
  const rect = computeCropRect({ box, imgDisplay, source });
  expect(rect.originX).toBe(750);
  expect(rect.width).toBe(250); // clamped: 1000 - 750
  expect(rect.originY).toBe(750);
  expect(rect.height).toBe(250);
});

test('defaultBox with no aspect is the whole image', () => {
  const img = { x: 10, y: 20, width: 100, height: 80 };
  expect(defaultBox(img)).toEqual({ x: 10, y: 20, width: 100, height: 80 });
});

test('defaultBox with 1:1 aspect is a centred square', () => {
  const img = { x: 0, y: 0, width: 200, height: 100 };
  const box = defaultBox(img, 1);
  expect(box.width).toBe(100);
  expect(box.height).toBe(100);
  expect(box.x).toBe(50);
  expect(box.y).toBe(0);
});
