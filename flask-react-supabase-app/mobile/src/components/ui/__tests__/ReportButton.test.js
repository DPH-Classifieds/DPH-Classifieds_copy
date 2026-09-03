jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../utils/apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn().mockResolvedValue({}) },
}));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ReportButton = require('../ReportButton').default;

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

test('ReportButton renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<ReportButton listingType="car" listingId="l-1" />);
  await findByText('Report');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('E7ECE9');
  expect(tree).toContain('5B655F');
  expect(tree).not.toContain('323535');
  expect(tree).not.toContain('A8B4AC');
});

test('ReportButton renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<ReportButton listingType="car" listingId="l-1" />);
  await findByText('Report');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('323535');
  expect(tree).toContain('A8B4AC');
  expect(tree).not.toContain('E7ECE9');
  expect(tree).not.toContain('5B655F');
});
