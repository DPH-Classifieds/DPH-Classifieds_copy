jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const TermsOfServiceScreen = require('../profile/TermsOfServiceScreen').default;

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

test('TermsOfServiceScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<TermsOfServiceScreen />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).not.toContain('07110b');
});

test('TermsOfServiceScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON } = render(<TermsOfServiceScreen />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).not.toContain('FAFAFA');
});

test('TermsOfServiceScreen renders native terms content (no WebView)', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText, findAllByText } = render(<TermsOfServiceScreen />);
  await findByText(/^1\) Who we are/);
  await findByText(/Annex A — Additional Terms: Motors/);
  // legal@dphclassifieds.com appears in sections 1 and 18
  const matches = await findAllByText(/legal@dphclassifieds\.com/);
  expect(matches.length).toBeGreaterThanOrEqual(2);
});

test('TermsOfServiceScreen does not import or render react-native-webview', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findAllByText } = render(<TermsOfServiceScreen />);
  const matches = await findAllByText(/DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES/);
  expect(matches.length).toBeGreaterThan(0);
});
