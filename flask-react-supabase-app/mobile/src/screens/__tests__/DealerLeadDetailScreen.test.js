jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui/LoadingSpinner', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LoadingSpinner = () => React.createElement(View, null);
  return { __esModule: true, default: LoadingSpinner };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({
      lead: { id: 'lead-1', status: 'new', source: 'call', event_count: 1 },
      listing: { title: '2024 Toyota Camry', price: 50000 },
      timeline: [],
    }),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const DealerLeadDetailScreen = require('../dealer/DealerLeadDetailScreen').default;

const route = { params: { leadId: 'lead-1' } };

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

test('DealerLeadDetailScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<DealerLeadDetailScreen route={route} />);
  await findByText('2024 Toyota Camry');
  // LIGHT_COLORS.surface = '#FFFFFF' (UNIQUE to LIGHT — header card / surfaces)
  // LIGHT_COLORS.accent = '#0B6B4C' (UNIQUE to LIGHT — listing price)
  // LIGHT_COLORS.borderLight = 'rgba(15,23,20,0.06)' (UNIQUE to LIGHT — field/timeline separators)
  // DARK_COLORS.surface = '#0C1C13' (UNIQUE to DARK)
  // DARK_COLORS.accent = '#8BD6B4' (UNIQUE to DARK)
  // DARK_COLORS.borderLight = 'rgba(139,214,180,0.06)' — has the LIGHT 15,23,20 substring
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('0B6B4C');
  expect(tree).toContain('15,23,20');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('8BD6B4');
});

test('DealerLeadDetailScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<DealerLeadDetailScreen route={route} />);
  await findByText('2024 Toyota Camry');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).toContain('139,214,180');
  expect(tree).not.toContain('15,23,20');
  expect(tree).not.toContain('0B6B4C');
});
