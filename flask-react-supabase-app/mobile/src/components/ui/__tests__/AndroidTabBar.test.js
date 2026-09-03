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

jest.mock('../../../components/ui/Sidebar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: ({ open }) =>
    React.createElement(View, { testID: 'sidebar', 'data-open': open ? 'yes' : 'no' })
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, ...props }) => React.createElement(View, props, children),
  };
});

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
const AndroidTabBar = require('../AndroidTabBar').default;
const { LIGHT_COLORS } = require('../../../constants/theme');

describe('AndroidTabBar — sidebar integration', () => {
  beforeEach(() => {
    mockColors = LIGHT_COLORS;
    mockTheme = 'light';
  });

  test('renders a hamburger button that opens the sidebar', () => {
    const state = { routes: [{ key: '1', name: '(explore)' }], routeNames: ['(explore)'] };
    const navigation = { emit: jest.fn(), navigate: jest.fn() };
    const { getByLabelText, getByTestId } = render(
      <AndroidTabBar state={state} descriptors={{}} navigation={navigation} insets={{ bottom: 0 }} />
    );
    expect(getByTestId('sidebar').props['data-open']).toBe('no');
    fireEvent.press(getByLabelText('Open navigation menu'));
    expect(getByTestId('sidebar').props['data-open']).toBe('yes');
  });
});