// ActivityIndicator sets its color as a prop, not in style. Style tree
// inspection can't observe that — pin the contract via the styles object the
// component passes into the spinner style prop. The message text color comes
// through in styles because it's a Text style.
let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const LoadingSpinner = require('../LoadingSpinner').default;

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

test('LoadingSpinner renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<LoadingSpinner message="Loading…" />);
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.textSecondary = '#000000'
  expect(tree).toContain('000000');
});

test('LoadingSpinner renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON } = render(<LoadingSpinner message="Loading…" />);
  const tree = flattenStyles(toJSON());
  // DARK_COLORS.textSecondary = '#A8B4AC'
  expect(tree).toContain('A8B4AC');
});
