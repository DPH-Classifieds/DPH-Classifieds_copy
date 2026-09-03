jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ pattern: [{ featured: 1 }, { normal: 5 }] }),
    patch: jest.fn().mockResolvedValue({ pattern: [{ featured: 1 }, { normal: 5 }] }),
  },
}));
jest.mock('../../../utils/toast', () => ({ toastApiError: jest.fn(), showSuccess: jest.fn() }));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const FeaturedPlacementSettings = require('../FeaturedPlacementSettings').default;

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

test('FeaturedPlacementSettings renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<FeaturedPlacementSettings />);
  await findByText('Save pattern');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('5B655F');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('8BD6B4');
});

test('FeaturedPlacementSettings renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<FeaturedPlacementSettings />);
  await findByText('Save pattern');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('A8B4AC');
  expect(tree).not.toContain('0B6B4C');
  expect(tree).not.toContain('5B655F');
});
