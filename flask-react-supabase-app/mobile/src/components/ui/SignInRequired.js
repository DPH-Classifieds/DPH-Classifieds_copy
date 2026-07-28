import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Text from './AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';

// Inline gate shown for auth-only tabs when logged out. onSignIn opens the
// (auth) modal.
export default function SignInRequired({ label, onSignIn }) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.inner}>
        <Ionicons name="lock-closed-outline" size={48} color={COLORS.accent} />
        <Text style={styles.title}>Sign in required</Text>
        <Text style={styles.subtitle}>{label}</Text>
        <TouchableOpacity style={styles.btn} onPress={onSignIn} activeOpacity={0.85}>
          <Text style={styles.btnText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  title: { color: COLORS.white, fontSize: 22, fontWeight: '700', marginTop: 8 },
  subtitle: { color: 'rgba(255,255,255,0.65)', fontSize: 15, textAlign: 'center' },
  btn: { backgroundColor: COLORS.accent, paddingVertical: 14, paddingHorizontal: 36, borderRadius: 12, marginTop: 16 },
  btnText: { color: COLORS.background, fontSize: 16, fontWeight: '700' },
});
