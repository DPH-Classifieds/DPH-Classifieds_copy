jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native/Libraries/Alert/Alert', () => ({ alert: jest.fn() }));
jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return { __esModule: true, default: (props) => React.createElement(Pressable, props, props.children) };
});
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
}));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const RedditSourcePanel = require('../../components/RedditSourcePanel').default;

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

const redditItem = {
  source_platform: 'reddit',
  source_url: 'https://www.reddit.com/r/DubaiPetrolHeads/comments/abc123/test/',
  id: 'r-1',
};

test('RedditSourcePanel renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<RedditSourcePanel item={redditItem} />);
  return findByText('Reddit').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('5B655F');
    expect(tree).not.toContain('A8B4AC');
  });
});

test('RedditSourcePanel renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<RedditSourcePanel item={redditItem} />);
  return findByText('Reddit').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('A8B4AC');
    expect(tree).not.toContain('5B655F');
  });
});
