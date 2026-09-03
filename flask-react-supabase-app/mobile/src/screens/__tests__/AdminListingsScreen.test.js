jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { FlashList: (props) => React.createElement(View, null, props.data && props.data.length > 0 ? React.createElement(View, null) : null) };
});
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
jest.mock('../../components/ui/FeatureListingModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => React.createElement(View, null) };
});
jest.mock('../../components/ui/ScreenEntrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenEntrance = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: ScreenEntrance };
});
jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const { View } = require('react-native');
  const PressableScale = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: PressableScale };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ listings: [], metadata: { total: 0, pending: 0, active: 0 } }),
  },
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminListingsScreen = require('../admin/AdminListingsScreen').default;

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

test('AdminListingsScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AdminListingsScreen navigation={navigation} />);
  await waitFor(() => {
    const tree = flattenStyles(toJSON());
    return tree.includes('All');
  });
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.surface = '#FFFFFF' (filterTab, kpiRow)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('8BD6B4');
});

test('AdminListingsScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AdminListingsScreen navigation={navigation} />);
  await waitFor(() => {
    const tree = flattenStyles(toJSON());
    return tree.includes('All');
  });
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('0E1512');
  expect(tree).not.toContain('0B6B4C');
});
