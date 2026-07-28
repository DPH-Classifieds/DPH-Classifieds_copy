import * as ImageManipulator from 'expo-image-manipulator';
import { Skia, ImageFormat } from '@shopify/react-native-skia';
import * as FileSystem from 'expo-file-system/legacy';
import { buildMatrix, isNeutral } from './colorMatrix';

// Image-edit primitives for the photo editor. Geometry (rotate/flip/crop) uses
// the already-installed expo-image-manipulator; colour (brightness/contrast/
// saturation/filters) is baked with a Skia offscreen surface + colour matrix.
// The pure math these rely on is unit-tested in colorMatrix/cropGeometry.

const JPEG = { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG };

// Rotate 90° clockwise. Returns { uri, width, height } (dims come back swapped).
export async function rotate90(uri) {
  return ImageManipulator.manipulateAsync(uri, [{ rotate: 90 }], JPEG);
}

export async function flipHorizontal(uri) {
  return ImageManipulator.manipulateAsync(uri, [{ flip: ImageManipulator.FlipType.Horizontal }], JPEG);
}

// rect: { originX, originY, width, height } in source pixels (see cropGeometry).
export async function cropImage(uri, rect) {
  return ImageManipulator.manipulateAsync(uri, [{ crop: rect }], JPEG);
}

// Bake the colour adjustments/filter into a new JPEG. No-op edit → original uri
// (guarded by isNeutral so we never pay the Skia round-trip for nothing).
export async function bakeColor(uri, colorState) {
  if (isNeutral(colorState)) return uri;

  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const data = Skia.Data.fromBase64(b64);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('Skia could not decode image');

  const w = image.width();
  const h = image.height();
  const surface = Skia.Surface.MakeOffscreen(w, h);
  if (!surface) throw new Error('Skia could not allocate a surface');

  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColorFilter(Skia.ColorFilter.MakeMatrix(buildMatrix(colorState)));
  canvas.drawImage(image, 0, 0, paint);
  surface.flush();

  const outB64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 92);
  const outUri = `${FileSystem.cacheDirectory}edit_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(outUri, outB64, { encoding: 'base64' });
  return outUri;
}
