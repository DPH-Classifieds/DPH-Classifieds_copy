import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

export default function RequireAuth({ children, navigation, redirectRoute }) {
  const { user } = useAuth();
  const [showPrompt, setShowPrompt] = useState(false);

  if (user) return children;

  const navigateToAuth = (screen, params) => {
    if (!navigation) return;
    const rootNav = navigation.getParent()?.getParent()?.getParent() || navigation.getParent()?.getParent() || navigation.getParent() || navigation;
    rootNav.navigate('Auth', { screen, params });
  };

  const handleLogin = () => {
    setShowPrompt(false);
    navigateToAuth('Login', { redirect: redirectRoute });
  };

  const handleSignup = () => {
    setShowPrompt(false);
    navigateToAuth('Signup', { redirect: redirectRoute });
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Ionicons name="lock-closed-outline" size={48} color={COLORS.textMuted} />
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
            <Ionicons name="log-in-outline" size={36} color={COLORS.accent} />
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
    if (navigation) {
      const rootNav = navigation.getParent()?.getParent()?.getParent() || navigation.getParent()?.getParent() || navigation.getParent() || navigation;
      rootNav.navigate('Auth', { screen: 'Login' });
    }
  };

  const handleConfirm = () => {
    setShowPrompt(false);
    if (pendingAction) {
      pendingAction();
      setPendingAction(null);
    }
  };

  const AuthPromptModal = () => (
    <Modal visible={showPrompt} transparent animationType="fade" onRequestClose={() => { setShowPrompt(false); setPendingAction(null); }}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Ionicons name="log-in-outline" size={36} color={COLORS.accent} />
          <Text style={styles.modalTitle}>Log In Required</Text>
          <Text style={styles.modalSubtitle}>You need to be logged in to do this.</Text>
          <TouchableOpacity style={styles.modalLoginBtn} onPress={handleLogin} activeOpacity={0.8}>
            <Text style={styles.modalLoginBtnText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.modalCancelBtn} onPress={() => { setShowPrompt(false); setPendingAction(null); }}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return { requireAuth, AuthPromptModal };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  title: { fontSize: 20, fontWeight: '700', color: COLORS.white, marginTop: 16 },
  subtitle: { fontSize: FONT_SIZES.md, color: COLORS.textSecondary, marginTop: 8, textAlign: 'center' },
  loginBtn: { marginTop: 24, backgroundColor: COLORS.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  loginBtnText: { color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZES.md },
  signupBtn: { marginTop: 12, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  signupBtnText: { color: COLORS.accent, fontWeight: '600', fontSize: FONT_SIZES.md },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: 28, width: '100%', alignItems: 'center', gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.white, marginTop: 8 },
  modalSubtitle: { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)', textAlign: 'center' },
  modalLoginBtn: { marginTop: 8, backgroundColor: COLORS.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  modalLoginBtnText: { color: COLORS.white, fontWeight: '700', fontSize: FONT_SIZES.md },
  modalSignupBtn: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 8, width: '100%', alignItems: 'center' },
  modalSignupBtnText: { color: COLORS.accent, fontWeight: '600', fontSize: FONT_SIZES.md },
  modalCancelBtn: { marginTop: 4, paddingVertical: 8 },
  modalCancelText: { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.sm },
});
