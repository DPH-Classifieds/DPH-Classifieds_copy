import React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('../hooks/useFeaturedPattern', () => {
  const pattern = [0];
  return () => pattern;
});
jest.mock('./HeroBackground', () => () => null);

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('../hooks/useListingCounts', () => () => null);
jest.mock('./ui/searchable-select', () => () => null);
jest.mock('./SeoMeta', () => () => null);
jest.mock('./BrowseSellCta', () => () => null);
jest.mock('./MarketplaceListingCard', () => () => null);

test('hero CTA primary button uses --ex-primary token, not hardcoded #0b6b4c', async () => {
  let container;
  await act(async () => {
    ({ container } = render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>
    ));
  });
  // Find any className containing a gradient that starts with --ex-primary.
  const allClasses = Array.from(container.querySelectorAll('*'))
    .map((el) => el.getAttribute('class') || '')
    .join('\n');
  expect(allClasses).not.toMatch(/from-\[#0b6b4c\]/);
  expect(allClasses).toMatch(/from-\[color:var\(--ex-primary\)\]/);
});

test('hero uses the original performance car asset above the fold', async () => {
  let container;
  await act(async () => {
    ({ container } = render(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>
    ));
  });

  const heroCar = container.querySelector('.cn-hero-car');
  expect(heroCar).toHaveAttribute('src', '/hero.avif');
  expect(heroCar).toHaveAttribute('loading', 'eager');
  expect(heroCar).toHaveAttribute('fetchpriority', 'high');
  expect(container.querySelector('.cn-hero-image')).toBeNull();
});
