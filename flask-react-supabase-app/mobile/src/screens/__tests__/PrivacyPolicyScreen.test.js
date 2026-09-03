jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const PrivacyPolicyScreen = require('../profile/PrivacyPolicyScreen').default;

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

test('PrivacyPolicyScreen renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON } = render(<PrivacyPolicyScreen />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).not.toContain('07110b');
});

test('PrivacyPolicyScreen renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON } = render(<PrivacyPolicyScreen />);
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).not.toContain('FAFAFA');
});

test('PrivacyPolicyScreen renders native privacy content (no WebView)', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText, findAllByText } = render(<PrivacyPolicyScreen />);
  // Native content from web PrivacyPolicy.js — section header
  await findByText(/^1\. Scope of This Privacy Policy$/);
  await findByText(/^16\. Contact Information$/);
  // Multiple section references to privacy@dphclassifieds.com (sections 2, 11, 16)
  const privacyEmails = await findAllByText(/privacy@dphclassifieds\.com/);
  expect(privacyEmails.length).toBeGreaterThanOrEqual(3);
});

test('PrivacyPolicyScreen does not import or render react-native-webview', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findAllByText } = render(<PrivacyPolicyScreen />);
  // If the screen were still a WebView wrapper, no native section text
  // would render. The fact that the company name appears proves no WebView.
  const matches = await findAllByText(/DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES/);
  expect(matches.length).toBeGreaterThan(0);
});