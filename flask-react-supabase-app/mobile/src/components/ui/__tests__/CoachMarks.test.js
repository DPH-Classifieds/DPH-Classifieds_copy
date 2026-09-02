jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../../constants/theme');
const CoachMarks = require('../CoachMarks').default;

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

const fakeRef = { current: null };

test('CoachMarks renders LIGHT_COLORS values when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const steps = [{ ref: fakeRef, title: 'Hello', text: 'Welcome' }];
  const { toJSON, findByText } = render(
    <CoachMarks visible steps={steps} onDone={jest.fn()} />
  );
  return findByText('Hello').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.surfaceHigh = '#EFF3F1' — UNIQUE to LIGHT
    expect(tree).toContain('EFF3F1');
    expect(tree).toContain('0B6B4C');
    expect(tree).not.toContain('112519');
    expect(tree).not.toContain('8BD6B4');
  });
});

test('CoachMarks renders DARK_COLORS values when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const steps = [{ ref: fakeRef, title: 'Hello', text: 'Welcome' }];
  const { toJSON, findByText } = render(
    <CoachMarks visible steps={steps} onDone={jest.fn()} />
  );
  return findByText('Hello').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('112519');
    expect(tree).toContain('8BD6B4');
    expect(tree).not.toContain('EFF3F1');
    expect(tree).not.toContain('0B6B4C');
  });
});
