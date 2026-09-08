import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RedditListingDetail from './RedditListingDetail';

// Heavy children not under test here.
jest.mock('./SavedListingToggleButton', () => ({ __esModule: true, default: () => null }));
jest.mock('./ImageLightbox', () => ({ __esModule: true, default: () => null }));

const listing = {
  id: 'r1',
  source_platform: 'reddit',
  make_year: 2006,
  car_manufacturer: 'Infiniti',
  car_model: 'G35',
  expected_selling_price: 6000,
  car_city: 'Dubai',
  images: [
    { display_url: 'https://cdn.example/a.jpg' },
    { display_url: 'https://cdn.example/b.jpg' },
    { display_url: 'https://cdn.example/c.jpg' },
  ],
};

const renderDetail = () =>
  render(
    <MemoryRouter>
      <RedditListingDetail listing={listing} listingType="car" />
    </MemoryRouter>
  );

const heroImg = () => screen.getByAltText('2006 Infiniti G35');

test('hero arrows step through the photos', () => {
  renderDetail();
  expect(heroImg()).toHaveAttribute('src', 'https://cdn.example/a.jpg');

  fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
  expect(heroImg()).toHaveAttribute('src', 'https://cdn.example/b.jpg');
  expect(screen.getByText('2 / 3')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
  expect(heroImg()).toHaveAttribute('src', 'https://cdn.example/a.jpg');
});

test('arrows wrap around at the ends', () => {
  renderDetail();

  fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }));
  expect(heroImg()).toHaveAttribute('src', 'https://cdn.example/c.jpg');

  fireEvent.click(screen.getByRole('button', { name: 'Next photo' }));
  expect(heroImg()).toHaveAttribute('src', 'https://cdn.example/a.jpg');
});

test('no arrows for a single photo', () => {
  render(
    <MemoryRouter>
      <RedditListingDetail listing={{ ...listing, images: [{ display_url: 'https://cdn.example/only.jpg' }] }} listingType="car" />
    </MemoryRouter>
  );
  expect(screen.queryByRole('button', { name: 'Next photo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous photo' })).not.toBeInTheDocument();
});
