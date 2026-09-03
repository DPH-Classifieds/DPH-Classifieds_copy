jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/ui/LoadingSpinner', () => {
  const React = require('react');
  const { View } = require('react-native');
  const LoadingSpinner = () => React.createElement(View, null);
  return { __esModule: true, default: LoadingSpinner };
});
jest.mock('../../components/ui/EmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  const EmptyState = () => React.createElement(View, null);
  return { __esModule: true, default: EmptyState };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ audit: [] }),
  },
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminDealerAuditLogScreen = require('../admin/AdminDealerAuditLogScreen').default;

const route = { params: {} };

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

test('AdminDealerAuditLogScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByPlaceholderText } = render(<AdminDealerAuditLogScreen route={route} />);
  await waitFor(() => {
    const tree = flattenStyles(toJSON());
    return tree.includes('No audit events');
  });
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  // LIGHT_COLORS.surface = '#FFFFFF' (searchBar)
  // LIGHT_COLORS.chipActiveText = '#FFFFFF' (filterChipTextActive — white text
  // on the green active chip for light-mode contrast, not accent)
  expect(tree).toContain('0E1512');
  expect(tree).toContain('FFFFFF');
  expect(tree).toContain('01351C'); // active chip keeps its green fill
  expect(tree).not.toContain('0B6B4C'); // accent no longer used for chip text
  expect(tree).not.toContain('05100a');
  expect(tree).not.toContain('0C1C13');
  expect(tree).not.toContain('8BD6B4');
});

test('AdminDealerAuditLogScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByPlaceholderText } = render(<AdminDealerAuditLogScreen route={route} />);
  await waitFor(() => {
    const tree = flattenStyles(toJSON());
    return tree.includes('No audit events');
  });
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('07110b');
  expect(tree).toContain('0C1C13');
  expect(tree).toContain('8BD6B4');
  expect(tree).not.toContain('0E1512');
  expect(tree).not.toContain('0B6B4C');
});
