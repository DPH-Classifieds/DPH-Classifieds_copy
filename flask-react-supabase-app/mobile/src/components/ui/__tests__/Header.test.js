jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const Header = require('../Header').default;

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

test('Header renders LIGHT_COLORS.background and textPrimary when theme is light', () => {
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<Header title="Browse" />);
  // LIGHT_COLORS.background  = '#FAFAFA'
  // DARK_COLORS.background   = '#07110b'
  // LIGHT_COLORS.textPrimary = '#0E1512'
  // DARK_COLORS.textPrimary  = '#FFFFFF'
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).toContain('0E1512');
  expect(tree).not.toContain('07110b');
});

test('Header renders DARK_COLORS.background and textPrimary when theme is dark', () => {
  mockColors = DARK_COLORS;
  const { toJSON } = render(<Header title="Browse" />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('FFFFFF');
  expect(tree).not.toContain('FAFAFA');
});
