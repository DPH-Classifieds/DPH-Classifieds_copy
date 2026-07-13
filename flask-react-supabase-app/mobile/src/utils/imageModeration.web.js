// The native TensorFlow pipeline depends on react-native-fs and is not
// available in Expo web bundles. Keep the same async contract on web and let
// the server-side review pipeline remain the source of truth there.
export function _resetModels() {}

export async function moderateImage() {
  return { blocked: false, reasons: [] };
}
