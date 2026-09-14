import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminMarketTracker from './AdminMarketTracker';
import apiClient from '../../utils/apiClient';

jest.mock('../../utils/apiClient', () => ({ get: jest.fn() }));

test('searches the backend for an exact cohort and renders real price history', async () => {
  apiClient.get.mockResolvedValue({
    market_tracker: {
      cohort: { make: 'Toyota', model: 'Camry', year: 2019 },
      average_price: 110000,
      median_price: 105000,
      min_price: 100000,
      max_price: 120000,
      listing_count: 2,
      min_sample_size: 5,
      sample_quality: 'low',
      history: [{ snapshot_date: '2026-09-11', average_price: 110000, median_price: 105000, listing_count: 2 }],
      history_note: 'Daily history is available from platform snapshots.',
    },
  });

  render(<AdminMarketTracker days={30} />);
  fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Toyota' } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'Camry' } });
  fireEvent.change(screen.getByLabelText('Model year'), { target: { value: '2019' } });
  fireEvent.click(screen.getByRole('button', { name: /track market/i }));

  await waitFor(() => expect(screen.getByText('Toyota Camry · 2019')).toBeInTheDocument());
  expect(apiClient.get).toHaveBeenCalledWith(expect.stringContaining('market_make=Toyota'));
  expect(screen.getByText(/Only 2 matching listings found/)).toBeInTheDocument();
  expect(screen.getByText('2026-09-11')).toBeInTheDocument();
  expect(screen.getAllByText(/AED/).length).toBeGreaterThan(0);
});
