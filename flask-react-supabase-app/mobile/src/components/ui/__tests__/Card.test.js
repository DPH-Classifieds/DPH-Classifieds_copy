let mockColors;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const Card = require('../Card').default;

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

test('Card renders LIGHT_COLORS.surface when theme is light', () => {
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<Card>{null}</Card>);
  // LIGHT_COLORS.surface = '#FFFFFF' (off-white card top)
  // DARK_COLORS.surface  = '#0C1C13' (green-tinted near-black card top)
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FFFFFF');
  expect(tree).not.toContain('0C1C13');
});

test('Card renders DARK_COLORS.surface when theme is dark', () => {
  mockColors = DARK_COLORS;
  const { toJSON } = render(<Card>{null}</Card>);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0C1C13');
  expect(tree).not.toContain('FFFFFF');
});
