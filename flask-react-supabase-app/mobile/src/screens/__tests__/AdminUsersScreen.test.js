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
jest.mock('../../components/ui/SearchBar', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  const SearchBar = (props) => React.createElement(TextInput, props);
  return { __esModule: true, default: SearchBar };
});
jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const { View } = require('react-native');
  const PressableScale = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: PressableScale };
});
jest.mock('../../components/ui/ScreenEntrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenEntrance = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: ScreenEntrance };
});
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' } }));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue({ users: [], total: 0 }),
  },
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const AdminUsersScreen = require('../admin/AdminUsersScreen').default;

const navigation = { navigate: jest.fn(), goBack: jest.fn() };

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

test('AdminUsersScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByPlaceholderText } = render(<AdminUsersScreen navigation={navigation} />);
  await findByPlaceholderText('Search users...');
  const tree = flattenStyles(toJSON());
  // LIGHT_COLORS.black = '#0E1512' (container)
  expect(tree).toContain('0E1512');
  expect(tree).not.toContain('05100a');
});

test('AdminUsersScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByPlaceholderText } = render(<AdminUsersScreen navigation={navigation} />);
  await findByPlaceholderText('Search users...');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('05100a');
  expect(tree).not.toContain('0E1512');
});
