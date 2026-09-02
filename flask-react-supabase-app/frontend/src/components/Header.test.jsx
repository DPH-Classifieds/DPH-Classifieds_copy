import React from 'react';
import { render } from '@testing-library/react';
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

test('header className uses theme tokens, not hardcoded rgba dark scrim', () => {
  // Force scrollY > 10 so the header renders the "scrolled" branch.
  Object.defineProperty(window, 'scrollY', { value: 200, configurable: true });

  const { container } = render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>
  );

  const header = container.querySelector('header');
  const cls = header?.getAttribute('class') || '';
  // The scrim is intentionally a dark brand surface in both themes; assert it
  // reads from a token (--ex-surface-dark) instead of a hardcoded rgba.
  expect(cls).not.toMatch(/rgba\(4,16,8/);
  expect(cls).toMatch(/var\(--ex-surface-dark\)/);

  // Brand mark uses theme accent token.
  const brand = Array.from(container.querySelectorAll('header span')).find(
    (node) => node.textContent === 'Classifieds'
  );
  expect(brand).toBeTruthy();
  const brandCls = brand?.getAttribute('class') || '';
  expect(brandCls).not.toMatch(/\[#8bd6b4\]/);
  expect(brandCls).toMatch(/var\(--ex-accent-green\)/);
});
