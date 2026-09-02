jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const ActionNoticeModal = require('../ActionNoticeModal').default;

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

test('ActionNoticeModal renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(
    <ActionNoticeModal visible type="success" title="Notice" message="Hello" onClose={jest.fn()} />
  );
  await findByText('Notice');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('E7ECE9');
  expect(tree).toContain('0B6B4C');
  expect(tree).not.toContain('8BD6B4');
});

test('ActionNoticeModal renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(
    <ActionNoticeModal visible type="success" title="Notice" message="Hello" onClose={jest.fn()} />
  );
  await findByText('Notice');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('0B6B4C');
  expect(tree).not.toContain('E7ECE9');
});
