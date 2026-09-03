jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
const mockOpenURL = jest.fn();
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: (...args) => mockOpenURL(...args),
}));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AboutScreen = require('../profile/AboutScreen').default;

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

const flattenText = (node) => {
  if (!node) return '';
  let out = '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node.props && typeof node.props.children !== 'undefined') {
    out += flattenText(node.props.children);
  }
  if (Array.isArray(node.children)) {
    out += node.children.map(flattenText).join('');
  } else if (node.children) {
    out += flattenText(node.children);
  }
  return out;
};

beforeEach(() => {
  mockOpenURL.mockClear();
});

test('AboutScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<AboutScreen />);
  await findByText('DPH Classifieds');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FAFAFA');
  expect(tree).not.toContain('07110b');
});

test('AboutScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<AboutScreen />);
  await findByText('DPH Classifieds');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).not.toContain('FAFAFA');
});

test('AboutScreen has no Linking.openURL calls (no web view)', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText } = render(<AboutScreen />);
  await findByText('DPH Classifieds');
  expect(mockOpenURL).not.toHaveBeenCalled();
});

test('AboutScreen renders native About content (no WebView)', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { findByText, queryByText } = render(<AboutScreen />);
  // Native content from web About.js — check for distinctive phrases
  await findByText(/UAE market/);
  await findByText(/Raise listing quality/);
  await findByText(/Open Reddit/);
  await findByText(/Open Instagram/);
  // No external dphclassifieds URLs exposed as visible text
  expect(queryByText(/dphclassifieds\.com/)).toBeNull();
});
