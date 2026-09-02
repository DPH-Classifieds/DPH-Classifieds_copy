import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('../hooks/useListingCounts', () => () => null);
jest.mock('./ui/searchable-select', () => () => null);
jest.mock('./SeoMeta', () => () => null);
jest.mock('./BrowseSellCta', () => () => null);
jest.mock('./MarketplaceListingCard', () => () => null);

test('hero CTA primary button uses --ex-primary token, not hardcoded #0b6b4c', () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <HomePage />
    </MemoryRouter>
  );
  // Find any className containing a gradient that starts with --ex-primary.
  const allClasses = Array.from(container.querySelectorAll('*'))
    .map((el) => el.getAttribute('class') || '')
    .join('\n');
  expect(allClasses).not.toMatch(/from-\[#0b6b4c\]/);
  expect(allClasses).toMatch(/from-\[color:var\(--ex-primary\)\]/);
});
