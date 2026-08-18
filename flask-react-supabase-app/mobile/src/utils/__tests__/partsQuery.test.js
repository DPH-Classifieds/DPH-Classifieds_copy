import { PARTS_SORT_OPTIONS, buildPartsQueryParams, buildPartsQuery } from '../partsQuery';

const base = { condition: '', partType: '', hideReddit: false, sort: 'Newest' };

describe('buildPartsQueryParams', () => {
  test('sends limit/offset, not page/per_page — backend only reads the former', () => {
    const p = buildPartsQueryParams(1, 15, base);
    expect(p).toContain('limit=15');
    expect(p).toContain('offset=0');
    expect(p.some((x) => x.startsWith('page='))).toBe(false);
    expect(p.some((x) => x.startsWith('per_page='))).toBe(false);
  });

  test('offset scales with page', () => {
    expect(buildPartsQueryParams(3, 15, base)).toContain('offset=30');
  });

  test('condition/partType map to backend param names directly', () => {
    const p = buildPartsQueryParams(1, 15, { ...base, condition: 'New', partType: 'Engine' });
    expect(p).toContain('condition=New');
    expect(p).toContain('part_type=Engine');
  });

  test('hideReddit adds exclude_reddit=true', () => {
    expect(buildPartsQueryParams(1, 15, { ...base, hideReddit: true })).toContain('exclude_reddit=true');
  });

  test('every sort option has a valid PostgREST order string', () => {
    for (const opt of PARTS_SORT_OPTIONS) {
      expect(opt.order).toMatch(/^[a-z_]+\.(asc|desc)$/);
    }
  });
});

describe('buildPartsQuery', () => {
  test('prefixes /api/parts and joins with &', () => {
    expect(buildPartsQuery(1, 15, base)).toMatch(/^\/api\/parts\?limit=15&offset=0&order=/);
  });
});
