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
  default: { get: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../utils/listingCache', () => ({
  prefetchListing: jest.fn(),
  prefetchListingWindow: jest.fn(),
}));
jest.mock('../../utils/toast', () => ({ toastApiError: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const RedditListScreen = require('../listing/RedditListScreen').default;

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

test('RedditListScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<RedditListScreen navigation={navigation} />);
  return findByText('Reddit Listings').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.background = '#FAFAFA', LIGHT_COLORS.textPrimary = '#0E1512', LIGHT_COLORS.textSecondary = '#000000'
    expect(tree).toContain('FAFAFA');
    expect(tree).toContain('000000');
    expect(tree).not.toContain('07110b');
  });
});

test('RedditListScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<RedditListScreen navigation={navigation} />);
  return findByText('Reddit Listings').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('07110b');
    expect(tree).toContain('A8B4AC');
    expect(tree).not.toContain('FAFAFA');
    expect(tree).not.toContain('5B655F');
  });
});
