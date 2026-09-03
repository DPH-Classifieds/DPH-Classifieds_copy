jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

let mockColors;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ListingCard = require('../ListingCard').default;

const item = {
  id: '1',
  category: 'cars',
  title: 'Test Car',
  price: 1000,
  priceLabel: 'AED 1,000',
  image: null,
  is_featured: false,
};

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

test('ListingCard renders LIGHT_COLORS.accent when theme is light', () => {
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<ListingCard item={item} index={0} onPress={() => {}} />);
  // LIGHT_COLORS.accent = '#0B6B4C' (darker mint — used for category badge
  // background and the price text on a light card).
  // DARK_COLORS.accent  = '#8BD6B4' (bright mint — only minted for dark cards).
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('8BD6B4');
});

test('ListingCard renders DARK_COLORS.accent when theme is dark', () => {
  mockColors = DARK_COLORS;
  const { toJSON } = render(<ListingCard item={item} index={0} onPress={() => {}} />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('0B6B4C');
});
