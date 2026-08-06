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
});
