jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme, colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue({ bikes: [] }) },
}));
jest.mock('../../utils/listingCache', () => ({
  prefetchListing: jest.fn(),
  prefetchListingWindow: jest.fn(),
}));
jest.mock('../../utils/swrCache', () => ({
  swrGet: jest.fn().mockResolvedValue({ value: [] }),
  swrSet: jest.fn(),
}));
jest.mock('../../utils/toast', () => ({ toastApiError: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const BikeListScreen = require('../listing/BikeListScreen').default;

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

test('BikeListScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<BikeListScreen navigation={navigation} />);
  return findByText('Browse Bikes').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.background = '#FAFAFA' (page base — unique to LIGHT)
    // LIGHT_COLORS.textSecondary = '#5B655F' (chip text — unique to LIGHT)
    // DARK_COLORS.background  = '#07110b' (page base — unique to DARK)
    // Note: 'FFFFFF' and '0C1C13' leak in from brand-invariant `white` and
    // non-migrated siblings (ListHeader / ScreenEntrance) — don't negative-assert.
    expect(tree).toContain('FAFAFA');
    expect(tree).toContain('5B655F');
    expect(tree).not.toContain('07110b');
  });
});

test('BikeListScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<BikeListScreen navigation={navigation} />);
  return findByText('Browse Bikes').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('07110b');
    expect(tree).toContain('A8B4AC');
    expect(tree).not.toContain('FAFAFA');
    expect(tree).not.toContain('5B655F');
  });
});
