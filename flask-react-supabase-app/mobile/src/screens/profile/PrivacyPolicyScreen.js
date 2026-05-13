import React from 'react';
import { StyleSheet, ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../../constants/theme';

export default function PrivacyPolicyScreen() {
  return (
    <WebView
      source={{ uri: 'https://dphclassifieds.com/privacy-policy' }}
      style={styles.container}
      startInLoadingState
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loading: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
});
