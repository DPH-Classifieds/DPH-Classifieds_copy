jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({
      analysis: { points: 2, current: 50000, first: 55000, min: 50000, max: 55000, change: -5000, change_pct: 9 },
      points: [
        { price: 55000, date: '2024-01-01' },
        { price: 50000, date: '2024-02-01' },
      ],
    }),
  },
}));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const PriceHistory = require('../PriceHistory').default;

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

test('PriceHistory renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<PriceHistory listingType="car" listingId="l-1" />);
  await findByText('Price History');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('15,23,20,0.10');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('139,214,180,0.12');
});

test('PriceHistory renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<PriceHistory listingType="car" listingId="l-1" />);
  await findByText('Price History');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('A8B4AC');
  expect(tree).toContain('139,214,180,0.12');
  expect(tree).not.toContain('15,23,20,0.10');
});
