import { BIKES_SORT_OPTIONS, buildBikesQueryParams, buildBikesQuery } from '../bikesQuery';

const base = { brand: '', type: '', priceRange: null, hideReddit: false, sort: 'Newest' };

describe('buildBikesQueryParams', () => {
  test('sends limit/offset, not page/per_page — backend only reads the former', () => {
    const p = buildBikesQueryParams(1, 15, base);
    expect(p).toContain('limit=15');
    expect(p).toContain('offset=0');
    expect(p.some((x) => x.startsWith('page='))).toBe(false);
    expect(p.some((x) => x.startsWith('per_page='))).toBe(false);
  });

  test('offset scales with page so page 2+ actually advances', () => {
    expect(buildBikesQueryParams(2, 15, base)).toContain('offset=15');
    expect(buildBikesQueryParams(3, 15, base)).toContain('offset=30');
  });

  test('brand/type map to bike_brand/bike_type (matches DB columns)', () => {
    const p = buildBikesQueryParams(1, 15, { ...base, brand: 'Honda', type: 'Sport' });
    expect(p).toContain('bike_brand=Honda');
    expect(p).toContain('bike_type=Sport');
  });

  test('price range maps to price_from/price_to (only nonzero bounds)', () => {
    const p = buildBikesQueryParams(1, 15, { ...base, priceRange: { min: 10000, max: 25000 } });
    expect(p).toContain('price_from=10000');
    expect(p).toContain('price_to=25000');
    const open = buildBikesQueryParams(1, 15, { ...base, priceRange: { min: 100000, max: 0 } });
    expect(open).toContain('price_from=100000');
    expect(open.some((x) => x.startsWith('price_to'))).toBe(false);
  });

  test('hideReddit adds exclude_reddit=true', () => {
    expect(buildBikesQueryParams(1, 15, { ...base, hideReddit: true })).toContain('exclude_reddit=true');
  });

  test('every sort option has a valid PostgREST order string', () => {
    for (const opt of BIKES_SORT_OPTIONS) {
      expect(opt.order).toMatch(/^[a-z_]+\.(asc|desc)$/);
    }
  });
});

describe('buildBikesQuery', () => {
  test('prefixes /api/bikes and joins with &', () => {
    expect(buildBikesQuery(1, 15, base)).toMatch(/^\/api\/bikes\?limit=15&offset=0&order=/);
  });
});
