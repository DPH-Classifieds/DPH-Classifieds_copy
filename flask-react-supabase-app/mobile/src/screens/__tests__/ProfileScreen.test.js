jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', created_at: '2026-01-15', phone_verified: true },
    signOut: jest.fn(),
    syncWithSupabase: jest.fn(),
  }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ total_listings: 3, saved_count: 1, total_views: 42 }),
    post: jest.fn().mockResolvedValue({}),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const ProfileScreen = require('../profile/ProfileScreen').default;

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

const flattenStyles = (node) => {
  if (!node) return '';
  let out = '';
  if (node.props && node.props.style) {
    const style = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style.flat().filter(Boolean))
      : node.props.style;
    out += ' ' + JSON.stringify(style);
  }
  if (Array.isArray(node.children)) {
    out += node.children.map(flattenStyles).join('');
  } else if (node.children) {
    out += flattenStyles(node.children);
  }
  return out;
};

test('ProfileScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<ProfileScreen navigation={navigation} />);
  await findByText('Profile');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).not.toContain('07110b');
  // Profile boxes carry green-tinted outlines + soft shadows in light mode.
  expect(tree).toContain('11,107,76');
  expect(tree).toContain('"shadowOpacity":0.08');
});

test('ProfileScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<ProfileScreen navigation={navigation} />);
  await findByText('Profile');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).not.toContain('FAFAFA');
  // Profile boxes carry ghost-mint outlines + shadows in dark mode.
  expect(tree).toContain('139,214,180');
  expect(tree).toContain('"shadowOpacity":0.3');
});

test('ProfileScreen exposes MyListings and EditListing links', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText } = render(<ProfileScreen navigation={navigation} />);
  await findByText('My Listings');
  await findByText('Edit Listing');
});

test('ProfileScreen does NOT render web-view-only rows (Privacy/Terms/About)', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { queryByText } = render(<ProfileScreen navigation={navigation} />);
  // Per the user's spec: "mobile should have all the app stuff in its profile
  // section" — external web URLs (Privacy Policy, Terms of Service, About DPH
  // web links) belong on the dedicated native screens, not in the profile
  // link list as Linking.openURL web-view entries.
  expect(queryByText('Privacy Policy')).toBeNull();
  expect(queryByText('Terms of Service')).toBeNull();
  expect(queryByText('About DPH')).toBeNull();
});

test('ProfileScreen still shows Contact Support as a mailto link (system, not web)', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText } = render(<ProfileScreen navigation={navigation} />);
  // Contact Support stays because it opens the system mail client (mailto:),
  // not a browser. It's not a web-view dropdown.
  await findByText('Contact Support');
});
