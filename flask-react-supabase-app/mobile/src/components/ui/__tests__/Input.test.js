jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const Input = require('../Input').default;

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

test('Input renders LIGHT_COLORS.surfaceHigher and textPrimary when theme is light', () => {
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<Input placeholder="Type here" />);
  // LIGHT_COLORS.surfaceHigher = '#E7ECE9' (input fill off-white-mint)
  // DARK_COLORS.surfaceHigher  = '#323535' (dark gray-green input fill)
  // LIGHT_COLORS.textPrimary   = '#0E1512'
  // DARK_COLORS.textPrimary    = '#FFFFFF'
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('E7ECE9');
  expect(tree).toContain('0E1512');
  expect(tree).not.toContain('323535');
});

test('Input renders DARK_COLORS.surfaceHigher and textPrimary when theme is dark', () => {
  mockColors = DARK_COLORS;
  const { toJSON } = render(<Input placeholder="Type here" />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('323535');
  expect(tree).toContain('FFFFFF');
  expect(tree).not.toContain('E7ECE9');
});
