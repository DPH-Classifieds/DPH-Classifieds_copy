jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

jest.mock('../../components/ui/PressableScale', () => {
  const React = require('react');
  const ReactNative = require('react-native');
  const PressableScale = React.forwardRef((props, ref) =>
    React.createElement(ReactNative.View, { ...props, ref })
  );
  return { __esModule: true, default: PressableScale };
});
jest.mock('../../components/ui/ScreenEntrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenEntrance = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: ScreenEntrance };
});
jest.mock('../../hooks/useStaggeredEntrance', () => ({
  useStaggeredEntrance: () => ({ animatedStyle: {} }),
}));

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme || 'light', colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../context/SavedListingsContext', () => ({
  useSavedListings: () => ({
    savedListings: { cars: [], bikes: [], plates: [], parts: [] },
    loading: false,
  }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn().mockResolvedValue([]),
    post: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../../utils/toast', () => ({ toastApiError: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const MyListingsScreen = require('../profile/MyListingsScreen').default;

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

test('MyListingsScreen renders LIGHT_COLORS values when theme is light', async () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<MyListingsScreen navigation={navigation} />);
  await findByText('Active');
  // LIGHT_COLORS.surface = '#FFFFFF' (tab fill) — UNIQUE to LIGHT
  // DARK_COLORS.surface  = '#0C1C13' (tab fill) — UNIQUE to DARK
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('"backgroundColor":"#FFFFFF"');
  expect(tree).not.toContain('"backgroundColor":"#0C1C13"');
});

test('MyListingsScreen renders DARK_COLORS values when theme is dark', async () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<MyListingsScreen navigation={navigation} />);
  await findByText('Active');
  const tree = flattenStyles(toJSON());
  expect(tree).toContain('"backgroundColor":"#0C1C13"');
  expect(tree).not.toContain('"backgroundColor":"#FFFFFF"');
});
