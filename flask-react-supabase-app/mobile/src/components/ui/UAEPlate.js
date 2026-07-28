import React from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import { LinearGradient } from 'expo-linear-gradient';

// Native mirror of the web `UAELicensePlate` component (frontend/src/components/
// UAELicensePlate.js + styles/UAELicensePlate.css) so plates render identically
// on mobile — a white plate with black code/number and the emirate's Arabic
// name in the middle. This is the single source of truth for the plate visual;
// PlateList, PlateDetail and the shared ListingCard all render it instead of a
// photo/placeholder. `height` scales every dimension so one component serves the
// small card thumbnail and the large detail hero.

// Full Arabic emirate name, matching the web component.
const CITY_NAMES_AR = {
  'Abu Dhabi': 'أبو ظبي',
  'Dubai': 'دبي',
  'Sharjah': 'الشارقة',
  'Ajman': 'عجمان',
  'Umm Al Quwain': 'أم القيوين',
  'Ras Al Khaimah': 'رأس الخيمة',
  'Fujairah': 'الفجيرة',
  'Al Ain': 'العين',
  'Other': 'الإمارات',
};

// Ajman plates carry a colourful stripe along the bottom (web `.ajman:after`).
const AJMAN_STRIPE = ['#e91e63', '#ff9800', '#2196f3', '#795548'];

export default function UAEPlate({ city, code, number, sold = false, height = 120, style }) {
  const cityNameAr = CITY_NAMES_AR[city] || 'الإمارات';
  const isAjman = (city || '').toLowerCase() === 'ajman';
  const isAbuDhabi = (city || '').toLowerCase() === 'abu dhabi';

  // Font/spacing ratios taken from the web plate (80px glyphs on a 140px plate).
  const glyph = Math.round(height * (isAbuDhabi ? 0.5 : 0.57));
  const uaeSize = Math.max(9, Math.round(height * 0.14));
  const arabicSize = Math.max(11, Math.round(height * 0.18));
  const border = Math.max(2, Math.round(height * 0.022));
  const radius = Math.max(6, Math.round(height * 0.06));
  const padH = Math.round(height * 0.12);

  return (
    <View
      style={[
        styles.plate,
        { height, borderWidth: border, borderRadius: radius, paddingHorizontal: padH },
        style,
      ]}
    >
      <View style={styles.left}>
        {!!code && (
          <Text style={[styles.glyph, { fontSize: glyph }]} numberOfLines={1} adjustsFontSizeToFit>
            {code}
          </Text>
        )}
      </View>
      <View style={styles.middle}>
        <Text style={[styles.uae, { fontSize: uaeSize }]}>U.A.E</Text>
        <Text style={[styles.arabic, { fontSize: arabicSize }]} numberOfLines={1} adjustsFontSizeToFit>
          {cityNameAr}
        </Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.glyph, styles.number, { fontSize: glyph }]} numberOfLines={1} adjustsFontSizeToFit>
          {number || ''}
        </Text>
      </View>

      {isAjman && (
        <LinearGradient
          colors={AJMAN_STRIPE}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.ajmanStripe, { height: Math.max(6, Math.round(height * 0.1)) }]}
        />
      )}

      {sold && (
        <View style={styles.soldRibbon} pointerEvents="none">
          <Text style={[styles.soldText, { fontSize: Math.max(10, Math.round(height * 0.14)) }]}>SOLD</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#000000',
    overflow: 'hidden',
    // Cross-platform soft shadow, matching the web box-shadow.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  left: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  middle: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  right: { flex: 2, alignItems: 'flex-end', justifyContent: 'center' },
  glyph: { color: '#000000', fontWeight: '900' },
  number: { letterSpacing: 2 },
  uae: { color: '#000000', fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  arabic: { color: '#000000', fontWeight: '700' },
  ajmanStripe: {
    position: 'absolute',
    bottom: 6,
    left: '10%',
    width: '80%',
    borderRadius: 3,
  },
  soldRibbon: {
    position: 'absolute',
    top: '50%',
    right: -30,
    backgroundColor: '#ff0000',
    paddingHorizontal: 40,
    paddingVertical: 4,
    transform: [{ translateY: -10 }, { rotate: '-45deg' }],
  },
  soldText: { color: '#ffffff', fontWeight: '900', letterSpacing: 1 },
});
