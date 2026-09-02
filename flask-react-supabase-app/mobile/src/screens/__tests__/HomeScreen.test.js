jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockImplementation(() => Promise.resolve({ cars: [], bikes: [], plates: [], parts: [] })),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const HomeScreen = require('../home/HomeScreen').default;

const navigation = { navigate: jest.fn() };

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

test('HomeScreen renders LIGHT_COLORS.background and accent when theme is light', async () => {
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<HomeScreen navigation={navigation} />);
  await findByText('DPH');
  // LIGHT_COLORS.background = '#FAFAFA' (page base)
  // LIGHT_COLORS.accent    = '#0B6B4C' (darker mint — DPH logo text + category icons)
  // DARK_COLORS.background = '#07110b' (deep green-black — UNIQUE)
  // DARK_COLORS.accent     = '#8BD6B4' (bright mint — UNIQUE)
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('07110b');
  expect(tree).not.toContain('8BD6B4');
});

test('HomeScreen renders DARK_COLORS.background and accent when theme is dark', async () => {
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<HomeScreen navigation={navigation} />);
  await findByText('DPH');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('FAFAFA');
  expect(tree).not.toContain('0B6B4C');
});
