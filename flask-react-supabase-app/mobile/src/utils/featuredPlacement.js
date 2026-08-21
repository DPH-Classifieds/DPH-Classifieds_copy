// Interleaves featured listings into a normal listing feed according to an
// admin-configured pattern (e.g. 3 featured, 3 normal, 2 featured, 4 normal,
// 1 featured — then repeats). Configured in Admin > Featured > Placement.
// Mirrors frontend/src/utils/featuredPlacement.js exactly.
//
// - Featured items never duplicate into the normal pool (deduped by id).
// - The pattern cycles for as long as there's anything left to place.
// - Once featured items run out, "featured" slots are silently backfilled
//   with normal items so the feed never renders short.
export function applyFeaturedPlacement(normalItems, featuredItems, pattern, getId = (x) => x.id) {
  if (!Array.isArray(normalItems) || normalItems.length === 0) return normalItems || [];
  if (!Array.isArray(featuredItems) || featuredItems.length === 0) return normalItems;
  if (!Array.isArray(pattern) || pattern.length === 0) return normalItems;

  const featuredIds = new Set(featuredItems.map(getId));
  const normalPool = normalItems.filter((item) => !featuredIds.has(getId(item)));
  const featuredPool = [...featuredItems];

  const result = [];
  let ni = 0;
  let fi = 0;
  let segIndex = 0;
  let guard = 0;
  const maxGuard = (normalPool.length + featuredPool.length) * 2 + pattern.length * 2;

  while ((ni < normalPool.length || fi < featuredPool.length) && guard++ < maxGuard) {
    const seg = pattern[segIndex % pattern.length];
    segIndex++;
    const isFeaturedSeg = typeof seg.featured === 'number';
    const count = isFeaturedSeg ? seg.featured : seg.normal;

    for (let i = 0; i < count; i++) {
      if (isFeaturedSeg && fi < featuredPool.length) {
        result.push(featuredPool[fi++]);
      } else if (ni < normalPool.length) {
        result.push(normalPool[ni++]);
      }
    }
  }

  return result;
}
