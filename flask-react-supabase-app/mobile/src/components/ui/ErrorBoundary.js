import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

// Root error boundary so a render crash shows a recoverable screen instead of a
// white/blank app. Function-based component (with a sibling class) because we
// need useTheme() for the fallback colours and React still requires a class
// for getDerivedStateFromError/componentDidCatch. The class delegates rendering
// to ErrorBoundaryView which can use the theme context.
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
    return <ErrorBoundaryView onReset={this.handleReset} />;
  }
}

function ErrorBoundaryView({ onReset }) {
  const { colors } = useTheme();
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: SPACING.xl,
    },
    title: {
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xl,
      fontWeight: '700',
      marginTop: SPACING.md,
    },
    message: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.md,
      textAlign: 'center',
      marginTop: SPACING.sm,
      marginBottom: SPACING.lg,
      lineHeight: 22,
    },
    button: {
      backgroundColor: colors.accent,
      paddingHorizontal: SPACING.xl,
      paddingVertical: SPACING.md,
      borderRadius: BORDER_RADIUS.pill,
    },
    buttonText: {
      color: colors.background,
      fontSize: FONT_SIZES.md,
      fontWeight: '700',
    },
  });
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={56} color={colors.warning} />
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>
        The app hit an unexpected error. Try again — your data is safe.
      </Text>
      <TouchableOpacity style={styles.button} onPress={onReset} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}
