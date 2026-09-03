jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui/LoadingSpinner', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LoadingSpinner = () => React.createElement(View, null);
  return { __esModule: true, default: LoadingSpinner };
});
jest.mock('../../components/ui/EmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  const EmptyState = () => React.createElement(View, null);
  return { __esModule: true, default: EmptyState };
});
jest.mock('../../components/ui/ListingPickerModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, null) };
});
jest.mock('../../components/ui/FeatureListingModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, null) };
});
jest.mock('../../components/ui/FeaturedPlacementSettings', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, null) };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue([]),
  },
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminFeaturedListingsScreen = require('../admin/AdminFeaturedListingsScreen').default;

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

test('AdminFeaturedListingsScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AdminFeaturedListingsScreen />);
  await waitFor(() => {
    const tree = flattenStyles(toJSON());
    return tree.includes('Listings');
  });
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.accent = '#0B6B4C' (addBtn, tabActive)
  // LIGHT_COLORS.textSecondary = '#5B655F' (headerCount)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('5B655F');
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('8BD6B4');
  expect(tree).not.toContain('A8B4AC');
});

test('AdminFeaturedListingsScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AdminFeaturedListingsScreen />);
  await waitFor(() => {
    const tree = flattenStyles(toJSON());
    return tree.includes('Listings');
  });
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('A8B4AC');
  expect(tree).not.toContain('0E1512');
  expect(tree).not.toContain('0B6B4C');
  expect(tree).not.toContain('5B655F');
});
