import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExplorePage from './ExplorePage';

// VirtuosoGrid virtualizes based on real layout measurements (ResizeObserver,
// offsetHeight/Width) that jsdom can't meaningfully provide — that's a
// third-party-library rendering concern, verified separately in a real
// browser, not something these unit tests should fight jsdom to reproduce.
// Mocked here as a plain pass-through so ExplorePage's OWN data/filter/search
// logic stays fully testable.
jest.mock('react-virtuoso', () => {
  const ReactForMock = require('react');
  return {
    VirtuosoGrid: ({ data, itemContent, listClassName, components }) => ReactForMock.createElement(
      'div',
      { className: listClassName },
      data.map((item, index) => ReactForMock.cloneElement(itemContent(index, item), { key: index })),
      components?.Footer ? ReactForMock.createElement(components.Footer) : null,
    ),
  };
});

jest.mock('./MarketplaceListingCard', () => ({ item }) => (
  <article data-testid="listing-card">
    <a href={item.route}>{item.title}</a>
  </article>
));
jest.mock('./ListingSkeleton', () => () => <div data-testid="listing-skeleton" />);
jest.mock('./SeoMeta', () => () => null);
jest.mock('./BrowseSellCta', () => () => null);
jest.mock('../hooks/useFeaturedPattern', () => () => []);
jest.mock('../hooks/useListingCounts', () => () => null);
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../utils/apiClient', () => ({ post: jest.fn() }));
jest.mock('./ui/search-bar', () => ({ value, onChange, onSubmit }) => (
  <form onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}>
    <input aria-label="Explore search" value={value} onChange={(event) => onChange(event.target.value)} />
    <button type="submit">Search</button>
  </form>
));

const TOTAL_CARS = 120;
const TOTAL_BIKES = 2;
const TOTAL_ALL_MODE = TOTAL_CARS + TOTAL_BIKES;

const makeCar = (id, title = `Car ${id}`) => ({
  id: `car-${id}`,
  make: 'Toyota',
  model: title,
  car_city: 'Dubai',
  price: 50000,
  created_at: `2026-01-${String((id % 28) + 1).padStart(2, '0')}`,
});

const makeBike = (id, brand = 'Honda') => ({
  id: `bike-${id}`,
  bike_brand: brand,
  bike_type: 'Sport',
  bike_model: 'CBR',
  price: 12000,
  created_at: `2026-01-${String((id % 28) + 1).padStart(2, '0')}`,
});

const response = (data) => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

beforeEach(() => {
  sessionStorage.clear();
  global.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  global.fetch = jest.fn((url) => {
    const href = String(url);
    if (href.includes('/featured-listings')) return response([]);
    // No reddit fixture data: the real /api/cars|bikes never return reddit
    // rows unless source_platform=reddit is explicitly requested, so the
    // mock must mirror that split — otherwise the "all" tab's dual dph+reddit
    // fetch double-counts the same fixture rows under both requests.
    if (href.includes('source_platform=reddit')) return response([]);
    if (href.includes('/api/cars')) return response({ cars: Array.from({ length: TOTAL_CARS }, (_, index) => makeCar(index)) });
    if (href.includes('/api/bikes')) return response({ bikes: [makeBike(1, 'Honda'), makeBike(2, 'Yamaha')] });
    return response([]);
  });
});

afterEach(() => {
  delete global.fetch;
  delete global.IntersectionObserver;
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/explore']}>
    <ExplorePage />
  </MemoryRouter>
);

describe('ExplorePage feed rendering', () => {
  it('feeds the full loaded+filtered dataset to the virtualized grid', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId('listing-card')).toHaveLength(TOTAL_ALL_MODE));
    expect(screen.getByText(new RegExp(`${TOTAL_ALL_MODE} live listings`))).toBeInTheDocument();
  });

  it('keeps filtering and listing navigation working', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('listing-card')).toHaveLength(TOTAL_ALL_MODE));

    const search = screen.getByLabelText('Explore search');
    fireEvent.change(search, { target: { value: 'Car 7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getAllByTestId('listing-card').length).toBeGreaterThan(0));
    expect(screen.getByText('Toyota Car 7')).toBeInTheDocument();
    // Substring search: "Car 70" also contains "Car 7", so it's expected to match too.
    expect(screen.queryByText('Toyota Car 70')).toBeInTheDocument();
    const firstCard = screen.getAllByTestId('listing-card')[0];
    expect(within(firstCard).getByRole('link')).toHaveAttribute('href', expect.stringContaining('/cars/'));
  });

  it('sends bike filter params to /api/bikes when a bike brand is chosen', async () => {
    sessionStorage.clear();
    global.fetch.mockClear();
    render(
      <MemoryRouter initialEntries={['/explore?category=bikes']}>
        <ExplorePage />
      </MemoryRouter>
    );

    // Open the filter drawer so the bike-brand select is mounted.
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));

    // Wait for the bike drawer select to render (populated from the bike
    // fixture above). The brand options only appear after /api/bikes loads.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Honda' })).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('All brands'), { target: { value: 'Honda' } });

    // After selecting a brand, the next /api/bikes request must carry
    // bike_brand=Honda in the URL — that's the server-side filter path
    // this task introduces.
    await waitFor(() => {
      const bikeCalls = global.fetch.mock.calls
        .map((call) => String(call[0]))
        .filter((url) => url.includes('/api/bikes'));
      expect(bikeCalls.some((url) => url.includes('bike_brand=Honda'))).toBe(true);
    });
  });
});
