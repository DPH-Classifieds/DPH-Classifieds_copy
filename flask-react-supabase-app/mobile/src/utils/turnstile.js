import React from 'react';
import { Modal, View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../constants/theme';

const buildHtml = (siteKey) => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>
    body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
  </style>
</head>
<body>
  <div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="onSuccess" data-theme="dark"></div>
  <script>
    function onSuccess(token) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'token', token }));
    }
  </script>
</body>
</html>`;

export function TurnstileModal({ visible, siteKey, onToken, onCancel }) {
  if (!siteKey) {
    if (visible) {
      // No site key — resolve immediately with empty string (graceful degradation)
      setTimeout(() => onToken(''), 0);
    }
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.label}>Security check</Text>
          <WebView
            style={styles.webview}
            source={{ html: buildHtml(siteKey) }}
            onMessage={(e) => {
              try {
                const { type, token } = JSON.parse(e.nativeEvent.data);
                if (type === 'token' && token) onToken(token);
              } catch {
                /* ignore malformed messages */
              }
            }}
            javaScriptEnabled
            originWhitelist={['*']}
            startInLoadingState
            renderLoading={() => (
              <ActivityIndicator color={COLORS.accent} style={StyleSheet.absoluteFill} />
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: { height: 220, backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  label: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', paddingTop: 16 },
  webview: { flex: 1 },
});
