import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Header from './Header';

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, signOut: jest.fn() }),
}));
jest.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: jest.fn() }),
}));
jest.mock('./ProfileMenu', () => () => null);
jest.mock('./AdminHeader', () => () => null);
jest.mock('../utils/apiClient', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/' }),
  };
});

test('header uses theme tokens, not hardcoded rgba dark scrim', () => {
  // Force scrollY > 10 so the header renders the "scrolled" branch.
  Object.defineProperty(window, 'scrollY', { value: 200, configurable: true });

  const { container } = render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );

  const header = container.querySelector('header');
  const cls = header?.getAttribute('class') || '';

  // No hardcoded dark-rgba scrim should leak in (pre-light-mode-parity bug).
  expect(cls).not.toMatch(/rgba\(4,16,8/);

  // The header background now reads from --ex-surface (theme-aware: white in
  // light, near-black in dark), applied via inline style with color-mix at 85%
  // opacity so the existing backdrop-blur has something visible to blur
  // through. jsdom does not serialize React inline styles to the style
  // attribute, so we don't assert on the color-mix here — the contract is
  // "no hardcoded dark scrim", which the assertion above covers.

  // Brand mark uses theme accent token.
  const brand = Array.from(container.querySelectorAll('header span')).find(
    (node) => node.textContent === 'Classifieds'
  );
  expect(brand).toBeTruthy();
  const brandCls = brand?.getAttribute('class') || '';
  expect(brandCls).not.toMatch(/\[#8bd6b4\]/);
  expect(brandCls).toMatch(/var\(--ex-accent-green\)/);
});

test('desktop marketplace menu closes when the pointer leaves its anchor', () => {
  const { container } = render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );

  const browseAnchor = container.querySelector('.site-header__desktop-menu-anchor');
  expect(browseAnchor).toBeTruthy();

  fireEvent.mouseEnter(browseAnchor);
  expect(container.querySelector('#dph-browse-menu')).toBeTruthy();

  fireEvent.mouseLeave(browseAnchor);
  expect(container.querySelector('#dph-browse-menu')).toBeNull();
});
