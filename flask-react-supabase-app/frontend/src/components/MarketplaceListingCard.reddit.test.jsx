import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketplaceListingCard from './MarketplaceListingCard';

// Heavy children not under test here.
jest.mock('./SavedListingToggleButton', () => ({ __esModule: true, default: () => null }));
jest.mock('../hooks/useSwipe', () => ({ __esModule: true, default: () => ({ current: null }) }));

const renderCard = (item) =>
  render(
    <MemoryRouter>
      <MarketplaceListingCard item={item} />
    </MemoryRouter>
  );

const redditPart = {
  id: 'p1',
  categoryKey: 'car-parts',
  categoryLabel: 'Engine',
  source_platform: 'reddit',
  subtitle: 'Engine • Dubai',
  description:
    'Posted by DPH Classifieds, imported from r/DubaiPetrolHeads. WTS: Aramspeed Cold Air intake...',
  route: '/parts/p1',
  priceLabel: 'AED 1,999',
  title: 'WTS: Aramspeed Cold Air intake',
  image: '/x.jpg',
};

describe('MarketplaceListingCard — reddit normalization', () => {
  it('drops the imported-from blurb on a reddit PART card, keeps the clean category subtitle', () => {
    renderCard(redditPart);
    expect(screen.queryByText(/Posted by DPH Classifieds/i)).toBeNull();
    expect(screen.getByText('Engine • Dubai')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Reddit/i })).toBeInTheDocument();
  });

  it('drops the blurb on a reddit BIKE card too', () => {
    renderCard({
      ...redditPart,
      id: 'b1',
      categoryKey: 'bikes',
      categoryLabel: 'Bike',
      subtitle: 'Sport • 1000 cc • Dubai',
      route: '/bikes/b1',
    });
    expect(screen.queryByText(/Posted by DPH Classifieds/i)).toBeNull();
    expect(screen.getByText('Sport • 1000 cc • Dubai')).toBeInTheDocument();
  });

  it('KEEPS a genuine seller description on a non-reddit part card', () => {
    renderCard({
      ...redditPart,
      id: 'p2',
      source_platform: undefined,
      description: 'Genuine OEM part, barely used.',
    });
    expect(screen.getByText('Genuine OEM part, barely used.')).toBeInTheDocument();
  });

  it('leaves reddit CAR cards unchanged: year·km·location, no blurb, Reddit badge', () => {
    renderCard({
      id: 'c1',
      categoryKey: 'cars',
      categoryLabel: 'Car',
      source_platform: 'reddit',
      year: 2016,
      kilometers: 178435,
      location: 'Dubai',
      description: 'Posted by DPH Classifieds, imported from r/DubaiPetrolHeads. ...',
      route: '/cars/c1',
      priceLabel: 'AED 35,000',
      title: 'Honda Accord',
      image: '/x.jpg',
    });
    expect(screen.getByText('2016 • 178,435 km • Dubai')).toBeInTheDocument();
    expect(screen.queryByText(/Posted by DPH Classifieds/i)).toBeNull();
    expect(screen.getByText('Reddit')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Reddit/i })).toBeInTheDocument();
  });

  it('non-reddit listing shows "View Listing", not "View Reddit"', () => {
    renderCard({ ...redditPart, id: 'p3', source_platform: undefined });
    expect(screen.getByRole('link', { name: /View Listing/i })).toBeInTheDocument();
    expect(screen.queryByText('Reddit')).toBeNull();
  });
});

test('renders a slim plate DTO without requiring the removed raw API row', () => {
  renderCard({
    id: 'plate-1',
    categoryKey: 'plates',
    categoryLabel: 'Plate',
    cityValue: 'Dubai',
    codeValue: '7',
    numberValue: '12345',
    route: '/plates/plate-1',
    priceLabel: 'AED 50,000',
    title: 'Dubai 7 12345',
  });

  expect(screen.getByText('دبي')).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('12345')).toBeInTheDocument();
});
