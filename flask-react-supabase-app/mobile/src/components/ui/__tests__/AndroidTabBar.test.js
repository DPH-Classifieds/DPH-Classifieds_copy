jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), impactAsync: jest.fn() }));
jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  const BlurView = ({ children, ...props }) => React.createElement(View, props, children);
  return { BlurView };
});
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ViewRN = ({ children, ...props }) => React.createElement(View, props, children);
  return {
    __esModule: true,
    default: { View: ViewRN, createAnimatedComponent: () => ViewRN },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withSpring: (v) => v,
  };
});

let mockColors;
let mockTheme;
jest.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: mockTheme || 'light',
    colors: mockColors,
    setTheme: jest.fn(),
    toggleTheme: jest.fn(),
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
  };
});

import React from 'react';
import { render, queryByLabelText, queryByTestId } from '@testing-library/react-native';
const { LIGHT_COLORS } = require('../../../constants/theme');
const AndroidTabBar = require('../AndroidTabBar').default;

describe('AndroidTabBar — no hamburger', () => {
  beforeEach(() => {
    mockColors = LIGHT_COLORS;
    mockTheme = 'light';
  });

  test('does NOT render a hamburger (Open navigation menu) button', () => {
    // Per the user's request: the 3-line hamburger on Android is removed.
    // The drawer is no longer reachable from AndroidTabBar.
    const state = { routes: [{ key: '1', name: '(explore)' }], routeNames: ['(explore)'] };
    const navigation = { emit: jest.fn(), navigate: jest.fn() };
    const { queryByLabelText } = render(
      <AndroidTabBar state={state} descriptors={{}} navigation={navigation} insets={{ bottom: 0 }} />
    );
    expect(queryByLabelText(/Open navigation menu/)).toBeNull();
  });
});