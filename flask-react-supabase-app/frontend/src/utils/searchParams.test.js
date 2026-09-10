import { readFilterState, writeFilterState } from './searchParams';

test('round-trips browse filter state through shareable URL params', () => {
  const defaults = { query: '', category: 'all', excludeReddit: false, extras: [] };
  const aliases = { query: 'q', category: 'part_type', excludeReddit: 'exclude_reddit', extras: 'extras' };
  const filters = { query: 'land cruiser', category: 'SUV', excludeReddit: true, extras: ['sunroof', 'leather'] };

  const params = writeFilterState(new URLSearchParams(), filters, defaults, aliases);
  expect(params.toString()).toBe('q=land+cruiser&part_type=SUV&exclude_reddit=true&extras=sunroof%2Cleather');
  expect(readFilterState(params, defaults, aliases)).toEqual(filters);
});

test('omits empty and default filters without dropping unrelated params', () => {
  const defaults = { query: '', sort: 'newest' };
  const params = new URLSearchParams('category=cars');
  const result = writeFilterState(params, defaults, defaults, { query: 'q', sort: 'sort' });

  expect(result.toString()).toBe('category=cars');
});
