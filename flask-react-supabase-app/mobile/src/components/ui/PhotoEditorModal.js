import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Modal, StyleSheet, Image as RNImage, ActivityIndicator, PanResponder, ScrollView } from 'react-native';
import Text from './AppText';
import { Canvas, Image as SkiaImage, ColorMatrix, useImage } from '@shopify/react-native-skia';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { showError } from '../../utils/toast';
import { buildMatrix } from '../../utils/colorMatrix';
import { fitContain, computeCropRect, defaultBox } from '../../utils/cropGeometry';
import { rotate90, flipHorizontal, cropImage, bakeColor } from '../../utils/bakeImageEdits';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MIN_CROP = 48;
const HANDLE = 26;

const ASPECTS = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:4', value: 3 / 4 },
];
const FILTERS = ['None', 'Mono', 'Sepia', 'Warm', 'Cool', 'Vivid'];
const NEUTRAL_COLOR = { brightness: 1, contrast: 1, saturation: 1, preset: 'None' };

// Lightweight slider (drag delta based, no absolute measurement) so we avoid a
// slider dependency for three controls.
function AdjustSlider({ label, value, min, max, onChange, styles }) {
  const [w, setW] = useState(1);
  const valueRef = useRef(value); valueRef.current = value;
  const startRef = useRef(value);
  const wRef = useRef(1); wRef.current = w;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startRef.current = valueRef.current; },
      onPanResponderMove: (_e, g) => {
        const delta = (g.dx / wRef.current) * (max - min);
        onChangeRef.current(clamp(startRef.current + delta, min, max));
      },
    })
  ).current;

  const pct = (value - min) / (max - min);
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{Math.round(value * 100)}%</Text>
      </View>
      <View
        style={styles.sliderTrack}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.sliderBase} />
        <View style={[styles.sliderFill, { width: `${pct * 100}%` }]} />
        <View style={[styles.sliderThumb, { left: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

export default function PhotoEditorModal({ visible, imageUri, onSave, onCancel }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0a0a0a' },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: SPACING.md, paddingTop: SPACING.xl, paddingBottom: SPACING.sm,
    },
    headerBtn: { padding: 6 },
    title: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: colors.textPrimary },
    cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: colors.textSecondary },
    saveBtn: { backgroundColor: colors.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 18, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
    saveText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: colors.onAccent },
    previewArea: { flex: 1, margin: SPACING.md, alignItems: 'center', justifyContent: 'center' },
    cropBox: {
      position: 'absolute', borderWidth: 2, borderColor: colors.white,
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    gridV: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
    gridH: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.35)' },
    handle: {
      position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2,
      backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    },
    handleBR: { right: -HANDLE / 2, bottom: -HANDLE / 2 },
    tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.border },
    tab: { alignItems: 'center', gap: 3, paddingHorizontal: SPACING.lg, paddingVertical: 4, borderRadius: BORDER_RADIUS.md },
    tabActive: { backgroundColor: colors.surface },
    tabText: { fontSize: FONT_SIZES.xs, color: colors.textSecondary },
    tabTextActive: { color: colors.accent },
    controls: { minHeight: 130, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, backgroundColor: '#141414' },
    chipsRow: { gap: SPACING.sm, paddingVertical: 4 },
    chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: BORDER_RADIUS.pill, backgroundColor: colors.surface, marginRight: SPACING.sm },
    chipActive: { backgroundColor: colors.primary },
    chipText: { color: colors.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    chipTextActive: { color: colors.chipActiveText },
    actionRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface, paddingVertical: 12, borderRadius: BORDER_RADIUS.md },
    actionText: { color: colors.textPrimary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
    sliderRow: { marginBottom: SPACING.md },
    sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    sliderLabel: { color: colors.textPrimary, fontSize: FONT_SIZES.sm },
    sliderValue: { color: colors.textSecondary, fontSize: FONT_SIZES.sm },
    sliderTrack: { height: 28, justifyContent: 'center' },
    sliderBase: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: colors.surface },
    sliderFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: colors.accent },
    sliderThumb: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: colors.white, marginLeft: -10, top: 4 },
    resetBtn: { alignSelf: 'flex-start', paddingVertical: 6 },
    resetText: { color: colors.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  }), [colors]);

  const [workingUri, setWorkingUri] = useState(imageUri);
  const [size, setSize] = useState(null);        // { width, height } of workingUri
  const [area, setArea] = useState(null);        // preview area layout
  const [mode, setMode] = useState('crop');      // crop | adjust | filter
  const [aspect, setAspect] = useState(null);
  const [box, setBox] = useState(null);          // crop box in area coords
  const [color, setColor] = useState(NEUTRAL_COLOR);
  const [busy, setBusy] = useState(false);

  const skImage = useImage(workingUri);

  // Reset everything when a new image is opened.
  useEffect(() => {
    if (!visible || !imageUri) return;
    setWorkingUri(imageUri);
    setColor(NEUTRAL_COLOR);
    setAspect(null);
    setSize(null);
    setBox(null);
    setMode('crop');
    RNImage.getSize(imageUri, (width, height) => setSize({ width, height }), () => setSize({ width: 1, height: 1 }));
  }, [visible, imageUri]);

  // Displayed image rect inside the preview area.
  const imgDisplay = size && area ? fitContain(size, area) : null;

  // (Re)initialise the crop box whenever the displayed image or aspect changes.
  useEffect(() => {
    if (imgDisplay) setBox(defaultBox(imgDisplay, aspect));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, area, aspect]);

  // Keep the latest geometry in refs for the pan responders.
  const boxRef = useRef(box); boxRef.current = box;
  const imgRef = useRef(imgDisplay); imgRef.current = imgDisplay;
  const aspectRef = useRef(aspect); aspectRef.current = aspect;
  const startBox = useRef(null);

  const movePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startBox.current = boxRef.current; },
      onPanResponderMove: (_e, g) => {
        const img = imgRef.current; const s = startBox.current;
        if (!img || !s) return;
        setBox({
          ...s,
          x: clamp(s.x + g.dx, img.x, img.x + img.width - s.width),
          y: clamp(s.y + g.dy, img.y, img.y + img.height - s.height),
        });
      },
    })
  ).current;

  const resizePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { startBox.current = boxRef.current; },
      onPanResponderMove: (_e, g) => {
        const img = imgRef.current; const s = startBox.current; const asp = aspectRef.current;
        if (!img || !s) return;
        const maxW = img.x + img.width - s.x;
        const maxH = img.y + img.height - s.y;
        let width = clamp(s.width + g.dx, MIN_CROP, maxW);
        let height = asp ? width / asp : clamp(s.height + g.dy, MIN_CROP, maxH);
        if (asp && height > maxH) { height = maxH; width = height * asp; }
        setBox({ ...s, width, height });
      },
    })
  ).current;

  const doRotate = useCallback(async () => {
    if (!workingUri) return;
    setBusy(true);
    try {
      const r = await rotate90(workingUri);
      setWorkingUri(r.uri);
      setSize({ width: r.width, height: r.height });
    } catch { showError('Rotate failed'); }
    setBusy(false);
  }, [workingUri]);

  const doFlip = useCallback(async () => {
    if (!workingUri) return;
    setBusy(true);
    try {
      const r = await flipHorizontal(workingUri);
      setWorkingUri(r.uri);
      setSize({ width: r.width, height: r.height });
    } catch { showError('Flip failed'); }
    setBusy(false);
  }, [workingUri]);

  const handleSave = useCallback(async () => {
    if (!size || !box || !imgDisplay) { onSave(workingUri); return; }
    setBusy(true);
    try {
      let uri = workingUri;
      const rect = computeCropRect({ box, imgDisplay, source: size });
      const isFull =
        rect.originX === 0 && rect.originY === 0 &&
        rect.width === size.width && rect.height === size.height;
      if (!isFull) uri = (await cropImage(uri, rect)).uri;
      uri = await bakeColor(uri, color);
      onSave(uri);
    } catch {
      showError('Edit failed', 'Using the un-edited photo.');
      onSave(workingUri);
    } finally {
      setBusy(false);
    }
  }, [workingUri, size, box, imgDisplay, color, onSave]);

  const matrix = buildMatrix(color);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen">
      <View style={styles.container}>
        <View style={styles.header}>
          <PressableScale onPress={onCancel} haptic="light" style={styles.headerBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </PressableScale>
          <Text style={styles.title}>Edit Photo</Text>
          <PressableScale onPress={handleSave} haptic="success" style={styles.saveBtn} disabled={busy}>
            {busy ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Text style={styles.saveText}>Done</Text>}
          </PressableScale>
        </View>

        <View style={styles.previewArea} onLayout={(e) => setArea(e.nativeEvent.layout)}>
          {imgDisplay && skImage ? (
            <>
              <Canvas style={{ position: 'absolute', left: imgDisplay.x, top: imgDisplay.y, width: imgDisplay.width, height: imgDisplay.height }}>
                <SkiaImage image={skImage} x={0} y={0} width={imgDisplay.width} height={imgDisplay.height} fit="fill">
                  <ColorMatrix matrix={matrix} />
                </SkiaImage>
              </Canvas>
              {mode === 'crop' && box && (
                <View
                  style={[styles.cropBox, { left: box.x, top: box.y, width: box.width, height: box.height }]}
                  {...movePan.panHandlers}
                >
                  <View style={styles.gridV} /><View style={styles.gridH} />
                  <View style={[styles.handle, styles.handleBR]} {...resizePan.panHandlers}>
                    <Ionicons name="resize" size={14} color={colors.black} />
                  </View>
                </View>
              )}
            </>
          ) : (
            <ActivityIndicator size="large" color={colors.accent} />
          )}
        </View>

        <View style={styles.tabs}>
          {['crop', 'adjust', 'filter'].map((m) => (
            <PressableScale key={m} onPress={() => setMode(m)} style={[styles.tab, mode === m && styles.tabActive]}>
              <Ionicons
                name={m === 'crop' ? 'crop' : m === 'adjust' ? 'options' : 'color-filter'}
                size={20}
                color={mode === m ? colors.accent : colors.textSecondary}
              />
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                {m[0].toUpperCase() + m.slice(1)}
              </Text>
            </PressableScale>
          ))}
        </View>

        <View style={styles.controls}>
          {mode === 'crop' && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                {ASPECTS.map((a) => (
                  <PressableScale
                    key={a.label}
                    onPress={() => setAspect(a.value)}
                    style={[styles.chip, aspect === a.value && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, aspect === a.value && styles.chipTextActive]}>{a.label}</Text>
                  </PressableScale>
                ))}
              </ScrollView>
              <View style={styles.actionRow}>
                <PressableScale onPress={doRotate} style={styles.actionBtn}>
<Ionicons name="refresh" size={20} color={colors.textPrimary} />
                <Text style={styles.actionText}>Rotate</Text>
              </PressableScale>
              <PressableScale onPress={doFlip} style={styles.actionBtn}>
                <Ionicons name="swap-horizontal" size={20} color={colors.textPrimary} />
                  <Text style={styles.actionText}>Flip</Text>
                </PressableScale>
              </View>
            </>
          )}

          {mode === 'adjust' && (
            <>
              <AdjustSlider styles={styles} label="Brightness" value={color.brightness} min={0.5} max={1.5} onChange={(v) => setColor((c) => ({ ...c, brightness: v }))} />
              <AdjustSlider styles={styles} label="Contrast" value={color.contrast} min={0.5} max={1.5} onChange={(v) => setColor((c) => ({ ...c, contrast: v }))} />
              <AdjustSlider styles={styles} label="Saturation" value={color.saturation} min={0} max={2} onChange={(v) => setColor((c) => ({ ...c, saturation: v }))} />
              <PressableScale onPress={() => setColor((c) => ({ ...c, brightness: 1, contrast: 1, saturation: 1 }))} style={styles.resetBtn}>
                <Text style={styles.resetText}>Reset adjustments</Text>
              </PressableScale>
            </>
          )}

          {mode === 'filter' && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {FILTERS.map((f) => (
                <PressableScale
                  key={f}
                  onPress={() => setColor((c) => ({ ...c, preset: f }))}
                  style={[styles.chip, color.preset === f && styles.chipActive]}
                >
                  <Text style={[styles.chipText, color.preset === f && styles.chipTextActive]}>{f}</Text>
                </PressableScale>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

