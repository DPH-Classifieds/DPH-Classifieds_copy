// Regression test for the sold/removed-listing fix: a background 404 must drop
// the listing to the "not found" state, even when opened from a stale list.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn() } }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../utils/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../context/SavedListingsContext', () => ({
  useSavedListings: () => ({ toggleSaveListing: jest.fn(), isSaved: () => false }),
}));
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../context/ThemeContext', () => {
  const { COLORS } = require('../constants/theme');
  return {
    useTheme: () => ({ theme: 'light', colors: COLORS, setTheme: jest.fn(), toggleTheme: jest.fn() }),
  };
});
jest.mock('../components/ui/RequireAuth', () => ({
  useAuthPrompt: () => ({ requireAuth: (f) => f && f(), AuthPromptModal: () => null }),
}));
jest.mock('../components/ui/PressableScale', () => 'PressableScale');
jest.mock('../components/RecommendedListings', () => 'RecommendedListings');
jest.mock('../components/ui/PriceHistory', () => 'PriceHistory');
jest.mock('../components/ui/ReportButton', () => 'ReportButton');
jest.mock('../components/ui/ListingMap', () => 'ListingMap');
jest.mock('../components/ui/LoanCalculator', () => 'LoanCalculator');
jest.mock('../components/RedditSourcePanel', () => ({
  __esModule: true, default: () => null, isRedditSourced: () => false,
}));
jest.mock('../utils/leadTracking', () => ({ trackLeadEvent: jest.fn() }));
jest.mock('../utils/whatsapp', () => ({ openWhatsapp: jest.fn(), formatWhatsappNumber: jest.fn() }));
jest.mock('../utils/contactAccess', () => ({ ensureContactAccess: jest.fn(() => true) }));
jest.mock('../utils/media', () => ({ resolveMediaUrl: (u) => u }));

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import apiClient from '../utils/apiClient';
import { prefetchListing } from '../utils/listingCache';
import CarDetailScreen from '../screens/listing/CarDetailScreen';

const nav = { navigate: jest.fn(), goBack: jest.fn() };

test('a 404 on the background fetch shows "Car not found"', async () => {
  const err = new Error('gone');
  err.status = 404;
  apiClient.get.mockRejectedValueOnce(err);

  // Opened from a stale list: we pass an initial listing, yet the 404 must win.
  render(
    <CarDetailScreen
      navigation={nav}
      route={{ params: { listingId: 'sold-1', listing: { id: 'sold-1', car_manufacturer: 'Toyota' } } }}
    />
  );

  expect(await screen.findByText('Car not found')).toBeTruthy();
});

test('a non-404 error keeps the listing rendered (no phantom removal)', async () => {
  const err = new Error('network');
  err.status = 500;
  apiClient.get.mockRejectedValueOnce(err);

  render(
    <CarDetailScreen
      navigation={nav}
      route={{ params: { listingId: 'ok-1', listing: { id: 'ok-1', car_manufacturer: 'Toyota', car_model: 'Supra', expected_selling_price: 200000 } } }}
    />
  );

  // Title still renders from the initial listing; not dropped to "not found".
  expect(await screen.findByText(/Toyota Supra/)).toBeTruthy();
  expect(screen.queryByText('Car not found')).toBeNull();
});

test('a stringified listing param is ignored; renders from cache without crashing', async () => {
  // expo-router serializes object params to "[object Object]"; that string must
  // NOT become `car` (else car.trim === String.prototype.trim and the spec grid
  // renders a function -> "Functions are not valid as a React child" crash).
  const car = {
    id: 'c9', car_manufacturer: 'Toyota', car_model: 'Supra', make_year: 2021,
    trim: 'GR', transmission_type: 'Automatic', expected_selling_price: 200000, images: [],
  };
  prefetchListing('cars', car);
  apiClient.get.mockResolvedValueOnce(car);

  render(<CarDetailScreen navigation={nav} route={{ params: { listingId: 'c9', listing: '[object Object]' } }} />);

  expect(await screen.findByText('GR')).toBeTruthy();          // trim spec renders as a string
  expect(await screen.findByText('Automatic')).toBeTruthy();
});
