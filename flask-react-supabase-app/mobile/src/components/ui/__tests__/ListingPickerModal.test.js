jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

jest.mock('../../../utils/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../../utils/toast', () => ({ toastApiError: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ListingPickerModal = require('../ListingPickerModal').default;

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

test('ListingPickerModal renders LIGHT_COLORS.surface and textPrimary when theme is light', async () => {
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<ListingPickerModal visible onClose={() => {}} onSelect={() => {}} />);
  await findByText('Choose a listing to feature');
  // LIGHT_COLORS.surface     = '#FFFFFF' (sheet surface)
  // LIGHT_COLORS.textPrimary = '#0E1512' (off-black ink)
  // DARK_COLORS.surface      = '#0C1C13' (green-tinted near-black — UNIQUE)
  // DARK_COLORS.textPrimary  = '#FFFFFF' (also a light-mode literal — not unique)
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0E1512');
  expect(tree).not.toContain('0C1C13');
});

test('ListingPickerModal renders DARK_COLORS.surface and textPrimary when theme is dark', async () => {
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<ListingPickerModal visible onClose={() => {}} onSelect={() => {}} />);
  await findByText('Choose a listing to feature');
  const tree = flattenStyles(toJSON());
  // Dark surface '#0C1C13' is unique to this theme; dark textPrimary '#FFFFFF'
  // overlaps with light surface, so we assert on the unique surface value only.
  expect(tree).toContain('0C1C13');
  expect(tree).not.toContain('0E1512');
});
