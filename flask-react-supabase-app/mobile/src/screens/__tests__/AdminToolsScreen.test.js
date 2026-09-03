jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ enabled: false }),
    patch: jest.fn().mockResolvedValue({ enabled: false }),
    post: jest.fn().mockResolvedValue({}),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminToolsScreen = require('../admin/AdminToolsScreen').default;

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

test('AdminToolsScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AdminToolsScreen />);
  await findByText('Auto Review');
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.surface = '#FFFFFF' (card)
  // LIGHT_COLORS.primary = '#01351C' (same in both themes)
  // LIGHT_COLORS.accent = '#0B6B4C' (runBtn)
  // LIGHT_COLORS.textSecondary = '#5B655F' (toggleLabel)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('5B655F');
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('8BD6B4');
  expect(tree).not.toContain('A8B4AC');
});

test('AdminToolsScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AdminToolsScreen />);
  await findByText('Auto Review');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('A8B4AC');
  expect(tree).not.toContain('0E1512');
  expect(tree).not.toContain('0B6B4C');
  expect(tree).not.toContain('5B655F');
});
