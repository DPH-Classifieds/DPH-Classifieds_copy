import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExplorePage, { MAX_RENDERED_ITEMS } from './ExplorePage';

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

const makeCar = (id, title = `Car ${id}`) => ({
  id: `car-${id}`,
  make: 'Toyota',
  model: title,
  car_city: 'Dubai',
  price: 50000,
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
    if (String(url).includes('/featured-listings')) return response([]);
    if (String(url).includes('/api/cars')) return response({ cars: Array.from({ length: 120 }, (_, index) => makeCar(index)) });
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

describe('ExplorePage bounded feed rendering', () => {
  it('mounts only the bounded initial card window for a large loaded dataset', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId('listing-card')).toHaveLength(MAX_RENDERED_ITEMS));
    expect(screen.getByRole('button', { name: /Show more loaded listings/ })).toBeInTheDocument();
    expect(screen.getByText(/120 live listings/)).toBeInTheDocument();
  });

  it('keeps filtering and listing navigation working inside the bounded window', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('listing-card')).toHaveLength(MAX_RENDERED_ITEMS));

    const search = screen.getByLabelText('Explore search');
    fireEvent.change(search, { target: { value: 'Car 7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.getAllByTestId('listing-card').length).toBeGreaterThan(0));
    expect(screen.getByText('Toyota Car 7')).toBeInTheDocument();
    expect(screen.queryByText('Toyota Car 70')).toBeInTheDocument();
    const firstCard = screen.getAllByTestId('listing-card')[0];
    expect(within(firstCard).getByRole('link')).toHaveAttribute('href', expect.stringContaining('/cars/'));
  });
});
