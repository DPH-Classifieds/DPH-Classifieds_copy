import React, { useState, useMemo } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import Text from './AppText';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function LoanCalculator({ price }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg,
      padding: SPACING.md, marginTop: SPACING.md,
    },
    headerRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
      marginBottom: SPACING.sm,
    },
    title: { color: colors.white, fontSize: FONT_SIZES.lg, fontWeight: '700' },
    resultInline: { alignItems: 'flex-end' },
    row: { flexDirection: 'row', gap: 8 },
    field: { flex: 1 },
    label: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, marginBottom: 4, height: 30 },
    input: {
      backgroundColor: colors.surfaceHigher, borderRadius: BORDER_RADIUS.md,
      borderWidth: 1, borderColor: colors.border, color: colors.white,
      fontSize: FONT_SIZES.sm, paddingHorizontal: 10, paddingVertical: 8,
    },
    resultLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.xs },
    resultValue: { color: colors.accent, fontSize: FONT_SIZES.lg, fontWeight: '700', marginTop: 2 },
  }), [colors]);

  const [downPayment, setDownPayment] = useState('');
  const [termYears, setTermYears] = useState('5');
  const [interestRate, setInterestRate] = useState('4.5');

  const monthlyPayment = useMemo(() => {
    const p = parseFloat(price) - (parseFloat(downPayment) || 0);
    const r = (parseFloat(interestRate) || 0) / 100 / 12;
    const n = (parseInt(termYears) || 5) * 12;
    if (p <= 0 || r <= 0) return p / n;
    return (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }, [price, downPayment, termYears, interestRate]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Loan Calculator</Text>
        <View style={styles.resultInline}>
          <Text style={styles.resultLabel}>Est. Monthly</Text>
          <Text style={styles.resultValue}>
            AED {monthlyPayment > 0 ? Math.ceil(monthlyPayment).toLocaleString() : '0'}
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.field}>
          <Text style={styles.label}>Down Payment (AED)</Text>
          <TextInput
            style={styles.input}
            value={downPayment}
            onChangeText={setDownPayment}
            placeholder="0"
            keyboardType="numeric"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Term (years)</Text>
          <TextInput
            style={styles.input}
            value={termYears}
            onChangeText={setTermYears}
            placeholder="5"
            keyboardType="numeric"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Rate (%)</Text>
          <TextInput
            style={styles.input}
            value={interestRate}
            onChangeText={setInterestRate}
            placeholder="4.5"
            keyboardType="numeric"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
        </View>
      </View>
    </View>
  );
}

