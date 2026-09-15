const createListingPreviewHandler = require('../../api/_listingPreview');

describe('listing social preview handler', () => {
  test('uses the first valid listing photo, not only the first array entry', () => {
    expect(createListingPreviewHandler.firstImage({
      images: [
        { display_url: '' },
        { image_url: 'https://cdn.example/listing.jpg' },
      ],
    })).toBe('https://cdn.example/listing.jpg');
  });

  test('renders crawler metadata with the listing photo', async () => {
    const handler = createListingPreviewHandler('cars', 'slug');
    const response = {
      ok: true,
      json: async () => ({
        id: 'car-1',
        make_year: 2022,
        car_manufacturer: 'Toyota',
        car_model: 'Camry',
        images: [{ image_url: 'https://cdn.example/camry.jpg' }],
      }),
    };
    global.fetch = jest.fn().mockResolvedValue(response);
    const sent = {};
    const res = {
      setHeader: jest.fn(),
      status: jest.fn(() => res),
      send: jest.fn((body) => { sent.body = body; }),
    };

    await handler({ query: { slug: 'toyota-camry-car-1' }, headers: { 'user-agent': 'WhatsApp' } }, res);

    expect(sent.body).toContain('property="og:image" content="https://cdn.example/camry.jpg"');
    expect(sent.body).toContain('Toyota Camry');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.dphclassifieds.com/api/cars/toyota-camry-car-1',
      expect.any(Object)
    );
  });
});
