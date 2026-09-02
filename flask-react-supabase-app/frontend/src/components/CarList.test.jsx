import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CarList from './CarList';

jest.mock('./MarketplaceListingCard', () => ({ item }) => (
  <article data-testid="listing-card">
    <a href={item.route}>{item.title}</a>
  </article>
));
jest.mock('./ui/searchable-select', () => () => <div data-testid="searchable-select" />);
jest.mock('./SeoMeta', () => () => null);
jest.mock('./BrowseSellCta', () => () => null);
jest.mock('./ListingSkeleton', () => () => <div data-testid="listing-skeleton" />);
jest.mock('../hooks/useListingCounts', () => () => null);
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../utils/apiClient', () => ({ post: jest.fn() }));

const fetchMock = jest.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
);

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockClear();
});

const renderCarList = () =>
  render(
    <MemoryRouter initialEntries={['/cars']}>
      <CarList />
    </MemoryRouter>
  );

test('initial fetch sends exclude_reddit=false (the unchecked default)', async () => {
  renderCarList();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
  const initialUrl = fetchMock.mock.calls[0][0];
  expect(initialUrl).toMatch(/exclude_reddit=false/);
});

test('toggling the Hide Reddit checkbox sends exclude_reddit=true', async () => {
  renderCarList();
  // Wait for the initial fetch to settle before triggering a re-fetch.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  fetchMock.mockClear();

  const checkbox = screen.getByRole('checkbox', { name: /hide reddit listings/i });
  fireEvent.click(checkbox);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const calledUrl = fetchMock.mock.calls[0][0];
  expect(calledUrl).toMatch(/exclude_reddit=true/);
});
