import React, { useState, useCallback, useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function RequireAuth({ children, navigation, redirectRoute }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [showPrompt, setShowPrompt] = useState(false);
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
    title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginTop: 16 },
    subtitle: { fontSize: FONT_SIZES.md, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },
    loginBtn: { marginTop: 24, backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
    loginBtnText: { color: colors.background, fontWeight: '700', fontSize: FONT_SIZES.md },
    signupBtn: { marginTop: 12, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
    signupBtnText: { color: colors.accent, fontWeight: '600', fontSize: FONT_SIZES.md },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: 28, width: '100%', alignItems: 'center', gap: 12 },
    modalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 8 },
    modalSubtitle: { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)', textAlign: 'center' },
    modalLoginBtn: { marginTop: 8, backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
    modalLoginBtnText: { color: colors.background, fontWeight: '700', fontSize: FONT_SIZES.md },
    modalSignupBtn: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
    modalSignupBtnText: { color: colors.accent, fontWeight: '600', fontSize: FONT_SIZES.md },
    modalCancelBtn: { marginTop: 4, paddingVertical: 8 },
    modalCancelText: { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.sm },
  }), [colors]);

  if (user) return children;

  // expo-router: push the auth modal screens. navigation.navigate('Auth', ...)
  // is React-Navigation syntax and no-ops in this app.
  const handleLogin = () => {
    setShowPrompt(false);
    router.push('/Login');
  };

  const handleSignup = () => {
    setShowPrompt(false);
    router.push('/Signup');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Ionicons name="lock-closed-outline" size={48} color={colors.textMuted} />
        <Text style={styles.title}>Sign in Required</Text>
        <Text style={styles.subtitle}>You need to be logged in to access this feature.</Text>
        <TouchableOpacity style={styles.loginBtn} onPress={() => setShowPrompt(true)} activeOpacity={0.8}>
          <Text style={styles.loginBtnText}>Log In</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signupBtn} onPress={handleSignup} activeOpacity={0.8}>
          <Text style={styles.signupBtnText}>Create Account</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showPrompt} transparent animationType="fade" onRequestClose={() => setShowPrompt(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Ionicons name="log-in-outline" size={36} color={colors.accent} />
            <Text style={styles.modalTitle}>Log In to Continue</Text>
            <Text style={styles.modalSubtitle}>
              {redirectRoute === 'Post' && 'Log in to post a listing.'}
              {redirectRoute === 'Saved' && 'Log in to view your saved listings.'}
              {redirectRoute === 'Profile' && 'Log in to view your profile.'}
              {!redirectRoute && 'Log in to continue.'}
            </Text>
            <TouchableOpacity style={styles.modalLoginBtn} onPress={handleLogin} activeOpacity={0.8}>
              <Text style={styles.modalLoginBtnText}>Log In</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSignupBtn} onPress={handleSignup} activeOpacity={0.8}>
              <Text style={styles.modalSignupBtnText}>Sign Up</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowPrompt(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function useAuthPrompt(navigation) {
  const { user } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const requireAuth = (action) => {
    if (user) {
      action();
    } else {
      setPendingAction(() => action);
      setShowPrompt(true);
    }
  };

  const handleLogin = () => {
    setShowPrompt(false);
    setPendingAction(null);
    router.push('/Login');
  };

  const handleConfirm = () => {
    setShowPrompt(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const handleCancel = () => { setShowPrompt(false); setPendingAction(null); };

  // ponytail: memoized wrapper keeps a STABLE component type across renders, so
  // React reconciles the sibling Modal instead of unmount/remount. Remounting a
  // sibling native Modal was thrashing the lightbox presentation (the photo-viewer
  // loop). Identity only changes when showPrompt does.
  const AuthPromptModal = useCallback(
    () => <AuthPromptModalView visible={showPrompt} onLogin={handleLogin} onCancel={handleCancel} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showPrompt]
  );

  return { requireAuth, AuthPromptModal };
}

function AuthPromptModalView({ visible, onLogin, onCancel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: 28, width: '100%', alignItems: 'center', gap: 12 },
    modalTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 8 },
    modalSubtitle: { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)', textAlign: 'center' },
    modalLoginBtn: { marginTop: 8, backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
    modalLoginBtnText: { color: colors.background, fontWeight: '700', fontSize: FONT_SIZES.md },
    modalSignupBtn: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
    modalSignupBtnText: { color: colors.accent, fontWeight: '600', fontSize: FONT_SIZES.md },
    modalCancelBtn: { marginTop: 4, paddingVertical: 8 },
    modalCancelText: { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.sm },
  }), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Ionicons name="log-in-outline" size={36} color={colors.accent} />
          <Text style={styles.modalTitle}>Log In Required</Text>
          <Text style={styles.modalSubtitle}>You need to be logged in to do this.</Text>
          <TouchableOpacity style={styles.modalLoginBtn} onPress={onLogin} activeOpacity={0.8}>
            <Text style={styles.modalLoginBtnText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancelBtn} onPress={onCancel}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

