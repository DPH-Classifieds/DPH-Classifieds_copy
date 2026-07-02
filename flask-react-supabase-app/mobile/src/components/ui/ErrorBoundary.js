import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

// Root error boundary so a render crash shows a recoverable screen instead of a
// white/blank app. Class component because that's the only way to catch render
// errors in React. ponytail: no error-reporting SDK wired — add Sentry here if
// crash telemetry is ever needed.
export default class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (__DEV__) console.error('ErrorBoundary caught:', error, info);
  }

  handleReset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={56} color={COLORS.warning} />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          The app hit an unexpected error. Try again — your data is safe.
        </Text>
        <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  title: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    marginTop: SPACING.md,
  },
  message: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
    lineHeight: 22,
  },
  button: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.pill,
  },
  buttonText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
});
