import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Modal, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import Text from './AppText';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const PAD = 8;           // spotlight padding around the target
const SCRIM = 'rgba(4,8,6,0.82)';

// First-run guided tour. Each step points a spotlight at a real on-screen
// element (measured via its ref) and shows a tooltip. Falls back to a centered
// tooltip with no cutout if a target can't be measured, so a missing ref never
// blocks the flow.
export default function CoachMarks({ visible, steps, onDone }) {
  const { width: W, height: H } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    scrim: { position: 'absolute', backgroundColor: SCRIM },
    highlight: {
      position: 'absolute',
      borderRadius: BORDER_RADIUS.lg,
      borderWidth: 2,
      borderColor: colors.accent,
    },
    tooltip: {
      position: 'absolute',
      alignSelf: 'center',
      backgroundColor: colors.surfaceHigh,
      borderRadius: BORDER_RADIUS.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: SPACING.md,
    },
    step: { color: colors.accent, fontSize: FONT_SIZES.xs, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
    title: { color: colors.white, fontSize: FONT_SIZES.lg, fontWeight: '800', marginBottom: 6 },
    text: { color: colors.textSecondary, fontSize: FONT_SIZES.md, lineHeight: 20 },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: SPACING.md,
    },
    skip: { color: colors.textMuted, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    nextBtn: {
      backgroundColor: colors.accent,
      paddingHorizontal: 20,
      paddingVertical: 9,
      borderRadius: BORDER_RADIUS.pill,
    },
    nextText: { color: colors.black, fontSize: FONT_SIZES.sm, fontWeight: '800' },
  }), [colors]);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const measure = useCallback((i) => {
    const node = steps?.[i]?.ref?.current;
    if (!node || typeof node.measureInWindow !== 'function') { setRect(null); return; }
    node.measureInWindow((x, y, w, h) => {
      if (w && h) setRect({ x, y, w, h });
      else setRect(null);
    });
  }, [steps]);

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    measure(index);
  }, [visible, index, measure]);

  if (!visible || !steps?.length) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const next = () => { if (isLast) onDone(); else setIndex((i) => i + 1); };

  // Spotlight box (target + padding), clamped to screen.
  const box = rect && {
    x: Math.max(0, rect.x - PAD),
    y: Math.max(0, rect.y - PAD),
    w: rect.w + PAD * 2,
    h: rect.h + PAD * 2,
  };

  // Place the tooltip below the target if there's room, otherwise above.
  const spaceBelow = box ? H - (box.y + box.h) : 0;
  const tooltipBelow = !box || spaceBelow > 220;

  const tooltipPos = box
    ? tooltipBelow
      ? { top: box.y + box.h + 12 }
      : { bottom: H - box.y + 12 }
    : { top: H / 2 - 90 };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        {box ? (
          <>
            {/* Four dim panels leave the target cut out. */}
            <View style={[styles.scrim, { top: 0, left: 0, right: 0, height: box.y }]} />
            <View style={[styles.scrim, { top: box.y + box.h, left: 0, right: 0, bottom: 0 }]} />
            <View style={[styles.scrim, { top: box.y, left: 0, width: box.x, height: box.h }]} />
            <View style={[styles.scrim, { top: box.y, left: box.x + box.w, right: 0, height: box.h }]} />
            <View
              pointerEvents="none"
              style={[styles.highlight, { top: box.y, left: box.x, width: box.w, height: box.h }]}
            />
          </>
        ) : (
          <View style={[styles.scrim, StyleSheet.absoluteFill]} />
        )}

        <View style={[styles.tooltip, tooltipPos, { maxWidth: Math.min(360, W - SPACING.md * 2) }]}>
          <Text style={styles.step}>{index + 1} of {steps.length}</Text>
          {step.title ? <Text style={styles.title}>{step.title}</Text> : null}
          <Text style={styles.text}>{step.text}</Text>
          <View style={styles.actions}>
            <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.nextBtn} onPress={next} activeOpacity={0.85}>
              <Text style={styles.nextText}>{isLast ? 'Got it' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

