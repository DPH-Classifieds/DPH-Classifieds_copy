import {
  CARS_SORT_OPTIONS,
  buildCarsQueryParams,
  buildCarsQuery,
} from '../carsQuery';

const base = {
  make: '', model: '', bodyType: '', city: '', yearFrom: '', yearTo: '',
  fuel: '', transmission: '', priceRange: null, mileageRange: null,
  hideReddit: false, sort: 'Newest',
};

describe('buildCarsQueryParams', () => {
  test('defaults: pagination + newest order, nothing else', () => {
    const p = buildCarsQueryParams(1, 15, base);
    expect(p).toContain('limit=15');
    expect(p).toContain('offset=0');
    expect(p).toContain('order=created_at.desc');
    expect(p.some((x) => x.startsWith('car_manufacturer'))).toBe(false);
    expect(p).not.toContain('exclude_reddit=true');
  });

  test('offset scales with page', () => {
    expect(buildCarsQueryParams(3, 15, base)).toContain('offset=30');
  });

  test('new sort options map to backend order values', () => {
    const order = (label) => {
      const p = buildCarsQueryParams(1, 15, { ...base, sort: label });
      return p.find((x) => x.startsWith('order=')).replace('order=', '');
    };
    expect(order('Year: Low to High')).toBe('make_year.asc');
    expect(order('KM: High to Low')).toBe('kilometer_driven.desc');
    expect(order('Year: High to Low')).toBe('make_year.desc');
  });

  test('mileage range maps to kilometer_from/to (only nonzero bounds)', () => {
    const p = buildCarsQueryParams(1, 15, { ...base, mileageRange: { min: 20000, max: 50000 } });
    expect(p).toContain('kilometer_from=20000');
    expect(p).toContain('kilometer_to=50000');
    const open = buildCarsQueryParams(1, 15, { ...base, mileageRange: { min: 150000, max: 0 } });
    expect(open).toContain('kilometer_from=150000');
    expect(open.some((x) => x.startsWith('kilometer_to'))).toBe(false);
  });

  test('hideReddit adds exclude_reddit=true', () => {
    expect(buildCarsQueryParams(1, 15, { ...base, hideReddit: true })).toContain('exclude_reddit=true');
  });

  test('filters map to backend car param names', () => {
    const p = buildCarsQueryParams(1, 15, { ...base, make: 'Toyota', city: 'Dubai' });
    expect(p).toContain('car_manufacturer=Toyota');
    expect(p).toContain('car_city=Dubai');
  });

  test('secondary (web-parity) filters map to backend params', () => {
    const p = buildCarsQueryParams(1, 15, {
      ...base, regionalSpec: 'GCC', steering: 'Left', seating: '5',
      horsepower: '200-299', engineCapacity: '2000-2499cc',
    });
    expect(p).toContain('regional_spec=GCC');
    expect(p).toContain('steering_side=Left');
    expect(p).toContain('seating_capacity=5');
    expect(p).toContain('horsepower=200-299');
    expect(p).toContain('engine_capacity=2000-2499cc');
  });

  test('every sort option has a valid PostgREST order string', () => {
    for (const opt of CARS_SORT_OPTIONS) {
      expect(opt.order).toMatch(/^[a-z_]+\.(asc|desc)$/);
    }
  });
});

describe('buildCarsQuery', () => {
  test('prefixes /api/cars and joins with &', () => {
    expect(buildCarsQuery(1, 15, base)).toMatch(/^\/api\/cars\?limit=15&offset=0&order=/);
  });
});
