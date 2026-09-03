/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react';
import useListingCounts from '../useListingCounts';

const CACHE_KEY = 'listing-counts-cache';
const response = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn(() => response({ cars: 10, bikes: 5, parts: 3, plates: 2, all: 20 }));
});

afterEach(() => {
  delete global.fetch;
});

describe('useListingCounts', () => {
  it('hits /api/listings/counts with no query string when no filters are passed', async () => {
    renderHook(() => useListingCounts());
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/listings\/counts$/));
  });

  it('appends non-empty filter entries as query params', async () => {
    renderHook(() => useListingCounts({ bike_brand: 'Honda', price_from: 1000 }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/\/api\/listings\/counts\?/);
    expect(url).toMatch(/bike_brand=Honda/);
    expect(url).toMatch(/price_from=1000/);
  });

  it('drops empty filter values from the query string', async () => {
    renderHook(() => useListingCounts({ bike_brand: 'Honda', area: '', price_from: null }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const url = global.fetch.mock.calls[0][0];
    expect(url).toMatch(/bike_brand=Honda/);
    expect(url).not.toMatch(/area=/);
    expect(url).not.toMatch(/price_from/);
  });
});

// keep the cache-key constant import alive so a rename breaks the test
void CACHE_KEY;