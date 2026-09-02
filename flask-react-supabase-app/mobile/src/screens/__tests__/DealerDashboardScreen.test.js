jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui/LoadingSpinner', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LoadingSpinner = () => React.createElement(View, null);
  return { __esModule: true, default: LoadingSpinner };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ is_dealer: true, dealership: { name: 'Test Motors', status: 'verified' }, tiles: {} }),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const DealerDashboardScreen = require('../dealer/DealerDashboardScreen').default;

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

test('DealerDashboardScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<DealerDashboardScreen navigation={navigation} />);
  // LIGHT_COLORS.surface = '#FFFFFF' (UNIQUE to LIGHT — kpi cards)
  // LIGHT_COLORS.accent = '#0B6B4C' (UNIQUE to LIGHT — verified pill / windowPillActive)
  // LIGHT_COLORS.black = '#0E1512' (UNIQUE to LIGHT — container background)
  // DARK_COLORS.surface = '#0C1C13' (UNIQUE to DARK)
  // DARK_COLORS.accent = '#8BD6B4' (UNIQUE to DARK)
  // DARK_COLORS.black = '#05100a'
  return findByText('Test Motors').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('FFFFFF');
    expect(tree).toContain('0B6B4C');
    expect(tree).toContain('0E1512');
    expect(tree).not.toContain('0C1C13');
    expect(tree).not.toContain('8BD6B4');
  });
});

test('DealerDashboardScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<DealerDashboardScreen navigation={navigation} />);
  return findByText('Test Motors').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('0C1C13');
    expect(tree).toContain('8BD6B4');
    expect(tree).toContain('05100a');
    expect(tree).not.toContain('0B6B4C');
    expect(tree).not.toContain('0E1512');
  });
});
