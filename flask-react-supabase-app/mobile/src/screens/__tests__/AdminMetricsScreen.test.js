jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockImplementation((url) => {
      if (url.includes('/health')) return Promise.resolve({ current: { overall_status: 'healthy', details: {} } });
      if (url.includes('email')) return Promise.resolve({ sent: 0, opened: 0 });
      return Promise.resolve({ user_metrics: {}, financial_metrics: {}, car_metrics: {}, plate_metrics: {}, raw_counts: {} });
    }),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminMetricsScreen = require('../admin/AdminMetricsScreen').default;

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

test('AdminMetricsScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AdminMetricsScreen />);
  await findByText('Last 7 days');
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.accent = '#0B6B4C' (windowBtnActive)
  // LIGHT_COLORS.background = '#FAFAFA' (active tab text)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('FAFAFA');
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('8BD6B4');
});

test('AdminMetricsScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AdminMetricsScreen />);
  await findByText('Last 7 days');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('05100a');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('07110b');
  expect(tree).not.toContain('0E1512');
  expect(tree).not.toContain('0B6B4C');
  expect(tree).not.toContain('FAFAFA');
});
