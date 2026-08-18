import { PLATES_SORT_OPTIONS, buildPlatesQueryParams, buildPlatesQuery } from '../platesQuery';

const base = { city: '', digits: '', hideReddit: false, sort: 'Newest' };

describe('buildPlatesQueryParams', () => {
  test('sends limit/offset, not page/per_page — backend only reads the former', () => {
    const p = buildPlatesQueryParams(1, 15, base);
    expect(p).toContain('limit=15');
    expect(p).toContain('offset=0');
    expect(p.some((x) => x.startsWith('page='))).toBe(false);
    expect(p.some((x) => x.startsWith('per_page='))).toBe(false);
  });

  test('offset scales with page', () => {
    expect(buildPlatesQueryParams(3, 15, base)).toContain('offset=30');
  });

  test('city/digits map to backend param names directly', () => {
    const p = buildPlatesQueryParams(1, 15, { ...base, city: 'Dubai', digits: '5' });
    expect(p).toContain('city=Dubai');
    expect(p).toContain('digits=5');
  });

  test('digits="Any" is treated as unset', () => {
    const p = buildPlatesQueryParams(1, 15, { ...base, digits: 'Any' });
    expect(p.some((x) => x.startsWith('digits='))).toBe(false);
  });

  test('hideReddit adds exclude_reddit=true', () => {
    expect(buildPlatesQueryParams(1, 15, { ...base, hideReddit: true })).toContain('exclude_reddit=true');
  });

  test('every sort option has a valid PostgREST order string', () => {
    for (const opt of PLATES_SORT_OPTIONS) {
      expect(opt.order).toMatch(/^[a-z_]+\.(asc|desc)$/);
    }
  });
});

describe('buildPlatesQuery', () => {
  test('prefixes /api/plates and joins with &', () => {
    expect(buildPlatesQuery(1, 15, base)).toMatch(/^\/api\/plates\?limit=15&offset=0&order=/);
  });
});
