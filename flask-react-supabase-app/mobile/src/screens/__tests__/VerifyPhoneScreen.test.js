jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

let mockColors;
let mockTheme;
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: mockTheme, colors: mockColors, setTheme: jest.fn(), toggleTheme: jest.fn() }),
}));
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, updateUser: jest.fn() }),
}));
jest.mock('../../utils/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue(null), post: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../utils/msg91', () => ({
  shouldUseMsg91: () => false,
  toMsg91Identifier: (phone) => phone,
  msg91SendOtp: jest.fn(),
  msg91RetryOtp: jest.fn(),
  msg91VerifyOtp: jest.fn(),
  MSG91_OTP_LENGTH: 6,
}));

import React from 'react';
import { render } from '@testing-library/react-native';

const { LIGHT_COLORS, DARK_COLORS } = require('../../constants/theme');
const VerifyPhoneScreen = require('../auth/VerifyPhoneScreen').default;

const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const route = { params: { phone: '501234567', countryCode: '+971', purpose: 'profile_verify' } };

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

test('VerifyPhoneScreen renders LIGHT_COLORS background and accent when theme is light', () => {
  mockTheme = 'light';
  mockColors = LIGHT_COLORS;
  const { toJSON, findByText } = render(<VerifyPhoneScreen navigation={navigation} route={route} />);
  return findByText('Verify Phone Number').then(() => {
    const tree = flattenStyles(toJSON());
    // LIGHT_COLORS.background = '#FAFAFA' (page base — unique to LIGHT)
    // LIGHT_COLORS.surfaceHigher = '#E7ECE9' (code picker bg — unique to LIGHT)
    // DARK_COLORS.background     = '#07110b' (page base — unique to DARK)
    // DARK_COLORS.surfaceHigher  = '#323535' (code picker bg — unique to DARK)
    expect(tree).toContain('FAFAFA');
    expect(tree).toContain('E7ECE9');
    expect(tree).not.toContain('07110b');
    expect(tree).not.toContain('323535');
  });
});

test('VerifyPhoneScreen renders DARK_COLORS background and surfaceHigher when theme is dark', () => {
  mockTheme = 'dark';
  mockColors = DARK_COLORS;
  const { toJSON, findByText } = render(<VerifyPhoneScreen navigation={navigation} route={route} />);
  return findByText('Verify Phone Number').then(() => {
    const tree = flattenStyles(toJSON());
    expect(tree).toContain('07110b');
    expect(tree).toContain('323535');
    expect(tree).not.toContain('FAFAFA');
    expect(tree).not.toContain('E7ECE9');
  });
});
