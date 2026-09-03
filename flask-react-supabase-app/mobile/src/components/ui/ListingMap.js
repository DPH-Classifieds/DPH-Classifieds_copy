import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Text from './AppText';
import MapView, { Marker } from '../../utils/mapComponents';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const UAE_CENTER = { latitude: 25.2048, longitude: 55.2708 };

export default function ListingMap({ latitude, longitude, title, city, emirate, area }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      borderRadius: BORDER_RADIUS.lg,
      overflow: 'hidden',
      marginTop: SPACING.md,
    },
    map: {
      width: '100%',
      height: 180,
    },
    placeholder: {
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.lg,
      padding: SPACING.md,
      marginTop: SPACING.md,
      alignItems: 'center',
    },
    placeholderText: {
      color: colors.textSecondary,
      fontSize: FONT_SIZES.sm,
    },
  }), [colors]);

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  if (!hasCoords) {
    const locationLabel = [city, area, emirate].filter(Boolean).join(', ');
    if (!locationLabel) return null;
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>{locationLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
      >
        <Marker coordinate={{ latitude: lat, longitude: lng }} title={title || 'Listing location'} />
      </MapView>
    </View>
  );
}
