jest.mock('../utils/apiClient', () => ({ post: jest.fn(() => Promise.resolve({})) }));

import apiClient from '../utils/apiClient';
import { buildNavigationStateChangeHandler, trackMobilePlatformEvent } from '../utils/platformTracker';

afterEach(() => jest.clearAllMocks());

test('sends anonymous platform events without requiring sign-in', async () => {
  await trackMobilePlatformEvent('page_view', { route: 'ExploreMain' });

  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/analytics/events',
    expect.objectContaining({ event_name: 'page_view', platform: 'mobile' }),
    { requiresAuth: false }
  );
});

test('records a listing detail navigation as a canonical listing_view', async () => {
  const navigationRef = {
    current: { getCurrentRoute: () => ({ name: 'CarDetail', params: { carId: 'car-1' } }) },
  };
  const onStateChange = buildNavigationStateChangeHandler(navigationRef);

  onStateChange();
  await Promise.resolve();
  await Promise.resolve();

  expect(apiClient.post).toHaveBeenCalledWith(
    '/api/analytics/events',
    expect.objectContaining({ event_name: 'listing_view', listing_type: 'car', listing_id: 'car-1' }),
    { requiresAuth: false }
  );
});
