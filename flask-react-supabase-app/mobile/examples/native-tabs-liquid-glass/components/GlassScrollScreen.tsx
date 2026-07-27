// Full-bleed scroll surface shared by every tab.
//
// `contentInsetAdjustmentBehavior="automatic"` is the critical native attribute:
// iOS insets the content for the transparent large-title header and the Liquid
// Glass tab bar on its own, while still rendering the scroll content edge-to-edge
// *behind* both bars — which is exactly what drives the dynamic system blur.
// Adding manual top/bottom safe-area padding here would both double-count the
// insets and kill the translucency effect, so we deliberately don't.
import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type GlassScrollScreenProps = {
  children: ReactNode;
  /** Extra styles merged into the scroll content container (e.g. custom gap). */
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export function GlassScrollScreen({
  children,
  contentContainerStyle,
}: GlassScrollScreenProps): React.JSX.Element {
  return (
    // The background fills the whole screen, including the area under the
    // translucent bars, so the blur has real pixels to sample.
    <View style={styles.fill}>
      <ScrollView
        style={styles.fill}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, contentContainerStyle]}
        showsVerticalScrollIndicator
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000000' },
  // Only horizontal padding — vertical insets are handled natively (see above).
  content: { paddingHorizontal: 16, gap: 12 },
});
