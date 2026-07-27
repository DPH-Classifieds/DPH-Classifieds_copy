jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../utils/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import apiClient from '../utils/apiClient';
import PriceHistory from '../components/ui/PriceHistory';

afterEach(() => jest.clearAllMocks());

test('stays hidden when the price never changed (single point)', async () => {
  apiClient.get.mockResolvedValueOnce({ analysis: { points: 1, current: 5000 }, points: [{ price: 5000 }] });
  const r = render(<PriceHistory listingType="cars" listingId="1" />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(r.toJSON()).toBeNull();
});

test('renders the analysis card when the price dropped', async () => {
  apiClient.get.mockResolvedValueOnce({
    analysis: { points: 3, first: 100000, current: 90000, min: 90000, max: 100000, change: -10000, change_pct: -10 },
    points: [{ price: 100000 }, { price: 95000 }, { price: 90000 }],
  });
  render(<PriceHistory listingType="cars" listingId="1" />);
  expect(await screen.findByText('Price History')).toBeTruthy();
  expect(await screen.findByText(/10%/)).toBeTruthy();
  expect(apiClient.get).toHaveBeenCalledWith('/api/cars/1/price-history');
});

test('stays hidden and silent when the request fails', async () => {
  apiClient.get.mockRejectedValueOnce(new Error('boom'));
  const r = render(<PriceHistory listingType="bikes" listingId="9" />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  expect(r.toJSON()).toBeNull();
});
