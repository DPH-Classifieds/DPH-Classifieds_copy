jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const SafeAreaView = ({ children, ...rest }) => React.createElement(View, rest, children);
  return { SafeAreaView };
});

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const SignInRequired = require('../SignInRequired').default;

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

test('SignInRequired renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<SignInRequired label="Sign in to continue" onSignIn={jest.fn()} />);
  return findByText('Sign In').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('0B6B4C');
    expect(tree).toContain('0E1512');
    expect(tree).not.toContain('8BD6B4');
    expect(tree).not.toContain('05100a');
  });
});

test('SignInRequired renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<SignInRequired label="Sign in to continue" onSignIn={jest.fn()} />);
  return findByText('Sign In').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('8BD6B4');
    expect(tree).toContain('07110b');
    expect(tree).not.toContain('0B6B4C');
    expect(tree).not.toContain('0E1512');
  });
});
