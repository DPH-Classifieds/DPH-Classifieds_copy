import { mergeListingDetail } from './listingRouteState';

test('keeps seller identity when the detail response omits it', () => {
  expect(mergeListingDetail(
    { id: 'car-1', seller_name: 'Suhayl' },
    { id: 'car-1', car_model: 'Land Cruiser', seller_name: null },
  )).toMatchObject({ id: 'car-1', car_model: 'Land Cruiser', seller_name: 'Suhayl' });
});
