import { applyFeaturedPlacement } from './featuredPlacement';

describe('applyFeaturedPlacement', () => {
  test('keeps featured listings visible when the normal feed is empty', () => {
    const featured = [{ id: 'featured-1' }];

    expect(applyFeaturedPlacement([], featured, [{ featured: 1 }, { normal: 5 }])).toEqual(featured);
  });

  test('does not duplicate a featured listing already present in the normal feed', () => {
    const normal = [{ id: 'featured-1' }, { id: 'normal-1' }];
    const featured = [{ id: 'featured-1' }];

    expect(applyFeaturedPlacement(normal, featured, [{ featured: 1 }, { normal: 5 }])).toEqual([
      { id: 'featured-1' },
      { id: 'normal-1' },
    ]);
  });
});
