// Pure geometry for the crop tool: fit the source image inside the editor area
// ("contain"), and map a crop box drawn in editor coordinates back to source
// pixels for expo-image-manipulator. Kept pure so the coordinate math is
// unit-tested (cropGeometry.test.js) rather than eyeballed on a device.

// Fit `source` (px) inside `area` (px) preserving aspect, centred.
// Returns the displayed image rect in area coordinates.
export function fitContain(source, area) {
  const scale = Math.min(area.width / source.width, area.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    x: (area.width - width) / 2,
    y: (area.height - height) / 2,
    width,
    height,
    scale,
  };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Map a crop `box` (editor coords) over the displayed image `imgDisplay`
// (from fitContain) to an integer source-pixel rect, clamped to the image.
export function computeCropRect({ box, imgDisplay, source }) {
  const scale = source.width / imgDisplay.width; // == source.height / imgDisplay.height
  const originX = clamp(Math.round((box.x - imgDisplay.x) * scale), 0, source.width);
  const originY = clamp(Math.round((box.y - imgDisplay.y) * scale), 0, source.height);
  const width = clamp(Math.round(box.width * scale), 1, source.width - originX);
  const height = clamp(Math.round(box.height * scale), 1, source.height - originY);
  return { originX, originY, width, height };
}

// Default crop box = the full displayed image, optionally constrained to an
// aspect ratio (w/h) centred within the image.
export function defaultBox(imgDisplay, aspect) {
  if (!aspect) return { x: imgDisplay.x, y: imgDisplay.y, width: imgDisplay.width, height: imgDisplay.height };
  let width = imgDisplay.width;
  let height = width / aspect;
  if (height > imgDisplay.height) {
    height = imgDisplay.height;
    width = height * aspect;
  }
  return {
    x: imgDisplay.x + (imgDisplay.width - width) / 2,
    y: imgDisplay.y + (imgDisplay.height - height) / 2,
    width,
    height,
  };
}
