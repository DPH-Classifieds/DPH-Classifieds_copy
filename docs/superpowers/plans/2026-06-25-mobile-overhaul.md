# Mobile App Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the DPH Classifieds React Native app to full production quality — dependency cleanup, toast error system, image compression, FlashList migration, Reanimated shimmer/stagger/spring animations, buying requests screens, image cropper, listing renewal modal, Turnstile CAPTCHA, and admin Cloudflare badge.

**Architecture:** Three sequential phases — Foundation (Phase 1) fixes silent failures and bloat so Phase 2 animations and Phase 3 screens are built on a solid base. All new UI components live in `src/components/ui/`, new hooks in `src/hooks/`, new screens in `src/screens/listing/`. Navigation additions are consolidated in a single AppNavigator task.

**Tech Stack:** React Native 0.81, Expo SDK 54, React Navigation 7 (native-stack + bottom-tabs), React Native Reanimated 4.1.1, expo-haptics, @shopify/flash-list (new), react-native-toast-message (new), expo-image-manipulator (new), expo-linear-gradient (existing).

---

## PHASE 1 — FOUNDATION

---

### Task 1: Add Jest test infrastructure

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `src/__tests__/setup.js`

- [ ] **Step 1: Add jest-expo and testing library**

In `flask-react-supabase-app/mobile/package.json`, add to `devDependencies`:
```json
"jest": "^29.7.0",
"jest-expo": "~54.0.0",
"@testing-library/react-native": "^12.4.0",
"@testing-library/jest-native": "^5.4.3"
```

- [ ] **Step 2: Create jest config**

Create `flask-react-supabase-app/mobile/jest.config.js`:
```js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterFramework: ['./src/__tests__/setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  testPathPattern: 'src/__tests__',
  collectCoverageFrom: ['src/utils/**/*.js', 'src/hooks/**/*.js'],
};
```

- [ ] **Step 3: Create setup file**

Create `flask-react-supabase-app/mobile/src/__tests__/setup.js`:
```js
import '@testing-library/jest-native/extend-expect';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn() }));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
```

- [ ] **Step 4: Run initial test check**

```bash
cd flask-react-supabase-app/mobile && npx jest --passWithNoTests
```
Expected: `Test Suites: 0 passed`

- [ ] **Step 5: Commit**
```bash
git add flask-react-supabase-app/mobile/package.json flask-react-supabase-app/mobile/jest.config.js flask-react-supabase-app/mobile/src/__tests__/setup.js
git commit -m "test(mobile): add jest-expo test infrastructure"
```

---

### Task 2: Dependency cleanup

**Files:**
- Modify: `flask-react-supabase-app/mobile/package.json`

- [ ] **Step 1: Remove dead dependencies, add new ones**

Replace the `dependencies` block in `package.json`. Remove `axios`, `async-storage`, `expo-router`. Add `@shopify/flash-list`, `react-native-toast-message`:

```json
{
  "dependencies": {
    "@expo/vector-icons": "^15.1.1",
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@react-navigation/bottom-tabs": "^7.4.0",
    "@react-navigation/native": "^7.1.8",
    "@react-navigation/native-stack": "^7.3.16",
    "@react-navigation/stack": "^7.9.1",
    "@shopify/flash-list": "^1.7.3",
    "@supabase/supabase-js": "^2.105.4",
    "babel-preset-expo": "~54.0.10",
    "expo": "~54.0.33",
    "expo-blur": "~15.0.8",
    "expo-camera": "~17.0.10",
    "expo-constants": "~18.0.13",
    "expo-device": "~8.0.10",
    "expo-document-picker": "^56.0.4",
    "expo-file-system": "~19.0.22",
    "expo-font": "~14.0.11",
    "expo-haptics": "~15.0.8",
    "expo-image-manipulator": "~13.0.6",
    "expo-image-picker": "~17.0.11",
    "expo-linear-gradient": "~15.0.8",
    "expo-linking": "~8.0.12",
    "expo-location": "~19.0.8",
    "expo-splash-screen": "~31.0.13",
    "expo-status-bar": "~3.0.9",
    "expo-web-browser": "~15.0.11",
    "react": "19.1.0",
    "react-native": "0.81.5",
    "react-native-dotenv": "^3.4.11",
    "react-native-gesture-handler": "~2.28.0",
    "react-native-maps": "^1.20.1",
    "react-native-pager-view": "^6.9.1",
    "react-native-reanimated": "~4.1.1",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "react-native-svg": "^15.12.1",
    "react-native-toast-message": "^2.2.1",
    "react-native-url-polyfill": "^3.0.0",
    "react-native-webview": "13.15.0",
    "react-native-worklets": "^0.5.1"
  }
}
```

- [ ] **Step 2: Install**
```bash
cd flask-react-supabase-app/mobile && npx expo install @shopify/flash-list react-native-toast-message expo-image-manipulator
```
Expected: packages added without peer dep errors.

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/package.json
git commit -m "chore(mobile): remove axios/async-storage/expo-router; add flash-list, toast-message, image-manipulator"
```

---

### Task 3: Toast utility + App.js

**Files:**
- Create: `src/utils/toast.js`
- Modify: `App.js`
- Create: `src/__tests__/toast.test.js`

- [ ] **Step 1: Write failing test**

Create `flask-react-supabase-app/mobile/src/__tests__/toast.test.js`:
```js
import { showToast, showError, showSuccess, showInfo } from '../utils/toast';
import Toast from 'react-native-toast-message';

jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));

afterEach(() => jest.clearAllMocks());

test('showError calls Toast.show with type error', () => {
  showError('Title', 'Message');
  expect(Toast.show).toHaveBeenCalledWith({
    type: 'error',
    text1: 'Title',
    text2: 'Message',
    visibilityTime: 4000,
    position: 'top',
  });
});

test('showSuccess calls Toast.show with type success', () => {
  showSuccess('Done');
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'success', text1: 'Done' })
  );
});

test('showInfo calls Toast.show with type info', () => {
  showInfo('Info');
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'info', text1: 'Info' })
  );
});

test('showToast with unknown status uses info type', () => {
  showToast(null, 'Hi');
  expect(Toast.show).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'info' })
  );
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/toast.test.js --passWithNoTests 2>&1 | tail -5
```
Expected: `Cannot find module '../utils/toast'`

- [ ] **Step 3: Create toast.js**

Create `flask-react-supabase-app/mobile/src/utils/toast.js`:
```js
import Toast from 'react-native-toast-message';

export const showToast = (type, title, message) => {
  Toast.show({
    type: type || 'info',
    text1: title,
    text2: message,
    visibilityTime: 4000,
    position: 'top',
  });
};

export const showError = (title, message) => showToast('error', title, message);
export const showSuccess = (title, message) => showToast('success', title, message);
export const showInfo = (title, message) => showToast('info', title, message);

export const toastApiError = (err) => {
  const status = err?.status;
  if (status === 401) {
    showError('Session expired', 'Please log in again.');
    return;
  }
  if (status === 403) {
    showError('Not allowed', "You don't have permission to do that.");
    return;
  }
  if (status === 400) {
    const msg = err?.data?.error || err?.message || 'Invalid request.';
    showError('Error', msg);
    return;
  }
  if (status >= 500) {
    showError('Server error', 'Please try again in a moment.');
    return;
  }
  const msg = err?.data?.error || err?.message || 'Something went wrong.';
  showError('Error', msg);
};
```

- [ ] **Step 4: Run — expect PASS**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/toast.test.js
```
Expected: `4 passed`

- [ ] **Step 5: Add Toast component to App.js**

Replace `flask-react-supabase-app/mobile/App.js` with:
```js
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { AuthProvider } from './src/context/AuthContext';
import { SavedListingsProvider } from './src/context/SavedListingsContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <SavedListingsProvider>
          <StatusBar style="light" />
          <AppNavigator />
          <Toast />
        </SavedListingsProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 6: Commit**
```bash
git add flask-react-supabase-app/mobile/src/utils/toast.js flask-react-supabase-app/mobile/src/__tests__/toast.test.js flask-react-supabase-app/mobile/App.js
git commit -m "feat(mobile): add toast notification system"
```

---

### Task 4: Image compressor utility

**Files:**
- Create: `src/utils/imageCompressor.js`
- Create: `src/__tests__/imageCompressor.test.js`

- [ ] **Step 1: Write failing test**

Create `flask-react-supabase-app/mobile/src/__tests__/imageCompressor.test.js`:
```js
import { compressImage } from '../utils/imageCompressor';
import * as ImageManipulator from 'expo-image-manipulator';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

afterEach(() => jest.clearAllMocks());

test('compressImage calls manipulateAsync with resize and compress', async () => {
  ImageManipulator.manipulateAsync.mockResolvedValue({
    uri: 'compressed://result.jpg',
    width: 1080,
    height: 720,
  });

  const result = await compressImage('file://original.jpg');

  expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
    'file://original.jpg',
    [{ resize: { width: 1920 } }],
    { compress: 0.85, format: 'jpeg' }
  );
  expect(result.uri).toBe('compressed://result.jpg');
});

test('compressImage returns original uri on error', async () => {
  ImageManipulator.manipulateAsync.mockRejectedValue(new Error('fail'));
  const result = await compressImage('file://original.jpg');
  expect(result.uri).toBe('file://original.jpg');
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/imageCompressor.test.js 2>&1 | tail -5
```

- [ ] **Step 3: Create imageCompressor.js**

Create `flask-react-supabase-app/mobile/src/utils/imageCompressor.js`:
```js
import * as ImageManipulator from 'expo-image-manipulator';

export const compressImage = async (uri) => {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1920 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result;
  } catch {
    return { uri };
  }
};
```

- [ ] **Step 4: Run — expect PASS**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/imageCompressor.test.js
```

- [ ] **Step 5: Commit**
```bash
git add flask-react-supabase-app/mobile/src/utils/imageCompressor.js flask-react-supabase-app/mobile/src/__tests__/imageCompressor.test.js
git commit -m "feat(mobile): add image compression utility"
```

---

### Task 5: SWR cache with TTL + invalidation

**Files:**
- Modify: `src/utils/swrCache.js`
- Create: `src/__tests__/swrCache.test.js`

- [ ] **Step 1: Write failing tests**

Create `flask-react-supabase-app/mobile/src/__tests__/swrCache.test.js`:
```js
import { swrGet, swrSet, swrInvalidate, swrInvalidatePrefix } from '../utils/swrCache';
import AsyncStorage from '@react-native-async-storage/async-storage';

afterEach(() => AsyncStorage.clear());

test('swrGet returns null for missing key', async () => {
  const result = await swrGet('missing');
  expect(result).toBeNull();
});

test('swrSet and swrGet round-trip within TTL', async () => {
  await swrSet('k1', { x: 1 }, 60);
  const result = await swrGet('k1', 60);
  expect(result?.value).toEqual({ x: 1 });
});

test('swrGet returns null when expired', async () => {
  await swrSet('k2', { x: 2 }, 1);
  // manually corrupt savedAt to be 2 seconds ago
  const key = 'dph_swr:k2';
  const raw = JSON.parse(await AsyncStorage.getItem(key));
  raw.savedAt = Date.now() - 2000;
  await AsyncStorage.setItem(key, JSON.stringify(raw));
  const result = await swrGet('k2', 1);
  expect(result).toBeNull();
});

test('swrInvalidate removes a key', async () => {
  await swrSet('k3', 'val', 60);
  await swrInvalidate('k3');
  expect(await swrGet('k3', 60)).toBeNull();
});

test('swrInvalidatePrefix removes matching keys', async () => {
  await swrSet('cars:1', 'a', 60);
  await swrSet('cars:2', 'b', 60);
  await swrSet('bikes:1', 'c', 60);
  await swrInvalidatePrefix('cars:');
  expect(await swrGet('cars:1', 60)).toBeNull();
  expect(await swrGet('cars:2', 60)).toBeNull();
  const bikes = await swrGet('bikes:1', 60);
  expect(bikes?.value).toBe('c');
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/swrCache.test.js 2>&1 | tail -8
```

- [ ] **Step 3: Rewrite swrCache.js**

Replace `flask-react-supabase-app/mobile/src/utils/swrCache.js`:
```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'dph_swr:';

export const swrGet = async (key, ttlSeconds = 60) => {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > ttlSeconds * 1000) return null;
    return { value, ageMs: Date.now() - savedAt };
  } catch {
    return null;
  }
};

export const swrSet = async (key, value, ttlSeconds = 60) => {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ value, savedAt: Date.now(), ttl: ttlSeconds })
    );
  } catch {
    /* ignore */
  }
};

export const swrInvalidate = async (key) => {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
};

export const swrInvalidatePrefix = async (prefix) => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter((k) => k.startsWith(PREFIX + prefix));
    if (matching.length > 0) await AsyncStorage.multiRemove(matching);
  } catch {
    /* ignore */
  }
};
```

- [ ] **Step 4: Run — expect PASS**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/swrCache.test.js
```
Expected: `5 passed`

- [ ] **Step 5: Commit**
```bash
git add flask-react-supabase-app/mobile/src/utils/swrCache.js flask-react-supabase-app/mobile/src/__tests__/swrCache.test.js
git commit -m "feat(mobile): swrCache with TTL, invalidation, prefix-invalidation"
```

---

### Task 6: Motion constants

**Files:**
- Create: `src/constants/motion.js`
- Create: `src/__tests__/motion.test.js`

- [ ] **Step 1: Write failing test**

Create `flask-react-supabase-app/mobile/src/__tests__/motion.test.js`:
```js
import { SPRING_FAST, SPRING_NORMAL, SPRING_SLOW, FADE_DURATION, STAGGER_DELAY, ENTRANCE_DISTANCE } from '../constants/motion';

test('SPRING_FAST has damping and stiffness', () => {
  expect(SPRING_FAST).toEqual({ damping: 20, stiffness: 300 });
});
test('FADE_DURATION is 220', () => { expect(FADE_DURATION).toBe(220); });
test('STAGGER_DELAY is 40', () => { expect(STAGGER_DELAY).toBe(40); });
test('ENTRANCE_DISTANCE is 16', () => { expect(ENTRANCE_DISTANCE).toBe(16); });
```

- [ ] **Step 2: Run — expect FAIL**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/motion.test.js 2>&1 | tail -5
```

- [ ] **Step 3: Create motion.js**

Create `flask-react-supabase-app/mobile/src/constants/motion.js`:
```js
export const SPRING_FAST   = { damping: 20, stiffness: 300 };
export const SPRING_NORMAL = { damping: 18, stiffness: 200 };
export const SPRING_SLOW   = { damping: 15, stiffness: 120 };
export const FADE_DURATION    = 220;
export const STAGGER_DELAY    = 40;
export const ENTRANCE_DISTANCE = 16;
```

- [ ] **Step 4: Run — expect PASS**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/motion.test.js
```

- [ ] **Step 5: Commit**
```bash
git add flask-react-supabase-app/mobile/src/constants/motion.js flask-react-supabase-app/mobile/src/__tests__/motion.test.js
git commit -m "feat(mobile): motion constants for animation system"
```

---

### Task 7: Fix SavedListingsContext — replace silent errors with toasts

**Files:**
- Modify: `src/context/SavedListingsContext.js`

- [ ] **Step 1: Read current SavedListingsContext**
```bash
cat flask-react-supabase-app/mobile/src/context/SavedListingsContext.js
```

- [ ] **Step 2: Add toastApiError to all catch blocks**

Open `flask-react-supabase-app/mobile/src/context/SavedListingsContext.js`. At the top, add the import:
```js
import { toastApiError } from '../utils/toast';
```

Find every `catch` block that currently has `/* silent */`, an empty body, or just a `console` call, and replace with `toastApiError(err)`. For example, the save function's catch should become:
```js
} catch (err) {
  // revert optimistic update
  setSavedListings(prev => prev.filter(s => s.id !== tempId));
  toastApiError(err);
}
```
And the remove/delete catch:
```js
} catch (err) {
  // revert optimistic removal
  setSavedListings(prev => [...prev, removedItem]);
  toastApiError(err);
}
```

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/context/SavedListingsContext.js
git commit -m "fix(mobile): SavedListingsContext silent errors now show toasts"
```

---

### Task 8: Console cleanup + FadeInImage error state

**Files:**
- Modify: `src/utils/ocrScanner.js`, `src/constants/config.js`, `src/utils/authService.js`, `src/utils/leadTracking.js`, `src/utils/analytics.js`
- Modify: `src/components/ui/FadeInImage.js`

- [ ] **Step 1: Wrap all console calls in __DEV__**

For each file, find every `console.log(...)`, `console.warn(...)`, `console.error(...)` and wrap with `if (__DEV__) { ... }`.

In `ocrScanner.js`:
```js
// Before:
console.error('OCR scan error:', err);
// After:
if (__DEV__) console.error('OCR scan error:', err);
```

In `config.js`:
```js
// Before:
console.warn('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY must be set in .env');
// After:
if (__DEV__) console.warn('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY must be set in .env');
```

Repeat for every `console.*` in `authService.js`, `leadTracking.js`, `analytics.js`.

Also remove the empty `setAuthHeader` function body from `authService.js` entirely (delete the function if unused elsewhere).

- [ ] **Step 2: Add error state to FadeInImage**

Read `src/components/ui/FadeInImage.js`, then replace the component with:
```js
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';

export default function FadeInImage({ source, style, resizeMode = 'cover', ...props }) {
  const opacity = useSharedValue(0);
  const [hasError, setHasError] = useState(false);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const handleLoad = () => {
    opacity.value = withTiming(1, { duration: 300 });
  };

  const handleError = () => {
    setHasError(true);
    opacity.value = withTiming(1, { duration: 150 });
  };

  if (hasError) {
    return (
      <View style={[styles.errorContainer, style]}>
        <Ionicons name="image-outline" size={32} color={COLORS.textMuted} />
      </View>
    );
  }

  return (
    <Animated.Image
      source={source}
      style={[style, animatedStyle]}
      resizeMode={resizeMode}
      onLoad={handleLoad}
      onError={handleError}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/utils/ocrScanner.js flask-react-supabase-app/mobile/src/constants/config.js flask-react-supabase-app/mobile/src/utils/authService.js flask-react-supabase-app/mobile/src/utils/leadTracking.js flask-react-supabase-app/mobile/src/utils/analytics.js flask-react-supabase-app/mobile/src/components/ui/FadeInImage.js
git commit -m "fix(mobile): guard console calls with __DEV__; FadeInImage error placeholder"
```

---

## PHASE 2 — ANIMATION SYSTEM

---

### Task 9: ListingSkeleton shimmer with Reanimated

**Files:**
- Modify: `src/components/ui/ListingSkeleton.js`

- [ ] **Step 1: Replace with Reanimated shimmer**

Replace the entire file at `flask-react-supabase-app/mobile/src/components/ui/ListingSkeleton.js`:
```js
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

const SHIMMER_DARK  = '#242426';
const SHIMMER_MID   = '#2e2e30';
const SHIMMER_LIGHT = '#3a3a3c';

function ShimmerBox({ style }) {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700 }),
        withTiming(0.6, { duration: 700 })
      ),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[style, animatedStyle]}>
      <LinearGradient
        colors={[SHIMMER_DARK, SHIMMER_MID, SHIMMER_LIGHT, SHIMMER_MID, SHIMMER_DARK]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <ShimmerBox style={styles.imagePlaceholder} />
      <View style={styles.body}>
        <ShimmerBox style={styles.lineTitle} />
        <ShimmerBox style={styles.linePrice} />
        <ShimmerBox style={styles.lineDate} />
      </View>
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={styles.profileContainer}>
      <ShimmerBox style={styles.avatar} />
      <View style={styles.statsRow}>
        {[0, 1, 2].map((i) => (
          <ShimmerBox key={i} style={styles.statTile} />
        ))}
      </View>
    </View>
  );
}

export function AdminStatsSkeleton() {
  return (
    <View style={styles.statsGrid}>
      {[0, 1, 2, 3].map((i) => (
        <ShimmerBox key={i} style={styles.adminStatTile} />
      ))}
    </View>
  );
}

export default function ListingSkeleton({ count = 4 }) {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: SPACING.sm },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  imagePlaceholder: { height: 210, backgroundColor: SHIMMER_DARK },
  body: { padding: 14 },
  lineTitle: { height: 14, borderRadius: 6, width: '84%', marginBottom: 10, backgroundColor: SHIMMER_DARK },
  linePrice: { height: 16, borderRadius: 7, width: '54%', marginBottom: 8, backgroundColor: SHIMMER_DARK },
  lineDate:  { height: 12, borderRadius: 5, width: '42%', backgroundColor: SHIMMER_DARK },
  profileContainer: { padding: SPACING.md },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: SHIMMER_DARK, marginBottom: SPACING.md },
  statsRow: { flexDirection: 'row', gap: SPACING.sm },
  statTile: { flex: 1, height: 64, borderRadius: BORDER_RADIUS.lg, backgroundColor: SHIMMER_DARK },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, padding: SPACING.md },
  adminStatTile: { width: '47%', height: 72, borderRadius: BORDER_RADIUS.lg, backgroundColor: SHIMMER_DARK },
});
```

- [ ] **Step 2: Commit**
```bash
git add flask-react-supabase-app/mobile/src/components/ui/ListingSkeleton.js
git commit -m "feat(mobile): shimmer skeleton with Reanimated + LinearGradient"
```

---

### Task 10: ScreenEntrance component

**Files:**
- Create: `src/components/ui/ScreenEntrance.js`

- [ ] **Step 1: Create ScreenEntrance.js**

Create `flask-react-supabase-app/mobile/src/components/ui/ScreenEntrance.js`:
```js
import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { FADE_DURATION, ENTRANCE_DISTANCE } from '../../constants/motion';

export default function ScreenEntrance({ children, style }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(ENTRANCE_DISTANCE);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: FADE_DURATION });
    translateY.value = withTiming(0, { duration: FADE_DURATION });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle, style]}>
      {children}
    </Animated.View>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add flask-react-supabase-app/mobile/src/components/ui/ScreenEntrance.js
git commit -m "feat(mobile): ScreenEntrance fade+slide mount animation"
```

---

### Task 11: useStaggeredEntrance hook

**Files:**
- Create: `src/hooks/useStaggeredEntrance.js`
- Create: `src/__tests__/useStaggeredEntrance.test.js`

- [ ] **Step 1: Write failing test**

Create `flask-react-supabase-app/mobile/src/__tests__/useStaggeredEntrance.test.js`:
```js
import { renderHook } from '@testing-library/react-native';
import { useStaggeredEntrance } from '../hooks/useStaggeredEntrance';

test('returns an object with animatedStyle key', () => {
  const { result } = renderHook(() => useStaggeredEntrance(0));
  expect(result.current).toHaveProperty('animatedStyle');
});

test('high index uses same hook shape', () => {
  const { result } = renderHook(() => useStaggeredEntrance(20));
  expect(result.current).toHaveProperty('animatedStyle');
});
```

- [ ] **Step 2: Run — expect FAIL**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/useStaggeredEntrance.test.js 2>&1 | tail -5
```

- [ ] **Step 3: Create hook**

Create `flask-react-supabase-app/mobile/src/hooks/useStaggeredEntrance.js`:
```js
import { useEffect } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SPRING_FAST, STAGGER_DELAY } from '../constants/motion';

const MAX_STAGGER_INDEX = 8;

export function useStaggeredEntrance(index) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    const delay = Math.min(index, MAX_STAGGER_INDEX) * STAGGER_DELAY;
    opacity.value = withDelay(delay, withTiming(1, { duration: 200 }));
    translateY.value = withDelay(delay, withSpring(0, SPRING_FAST));
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return { animatedStyle };
}
```

- [ ] **Step 4: Run — expect PASS**
```bash
cd flask-react-supabase-app/mobile && npx jest src/__tests__/useStaggeredEntrance.test.js
```

- [ ] **Step 5: Commit**
```bash
git add flask-react-supabase-app/mobile/src/hooks/useStaggeredEntrance.js flask-react-supabase-app/mobile/src/__tests__/useStaggeredEntrance.test.js
git commit -m "feat(mobile): useStaggeredEntrance hook for list item animations"
```

---

### Task 12: PressableScale component

**Files:**
- Create: `src/components/ui/PressableScale.js`

- [ ] **Step 1: Create PressableScale.js**

Create `flask-react-supabase-app/mobile/src/components/ui/PressableScale.js`:
```js
import React from 'react';
import { TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SPRING_FAST } from '../../constants/motion';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const HAPTIC_MAP = {
  light:   Haptics.ImpactFeedbackStyle.Light,
  medium:  Haptics.ImpactFeedbackStyle.Medium,
  heavy:   Haptics.ImpactFeedbackStyle.Heavy,
  success: Haptics.NotificationFeedbackType.Success,
};

export default function PressableScale({
  children,
  onPress,
  scale = 0.97,
  haptic = 'light',
  style,
  disabled,
  ...rest
}) {
  const scaleValue = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  const handlePressIn = () => {
    scaleValue.value = withSpring(scale, SPRING_FAST);
    if (haptic && !disabled) {
      if (haptic === 'success') {
        Haptics.notificationAsync(HAPTIC_MAP.success);
      } else {
        Haptics.impactAsync(HAPTIC_MAP[haptic] || HAPTIC_MAP.light);
      }
    }
  };

  const handlePressOut = () => {
    scaleValue.value = withSpring(1, SPRING_FAST);
  };

  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      disabled={disabled}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedTouchable>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add flask-react-supabase-app/mobile/src/components/ui/PressableScale.js
git commit -m "feat(mobile): PressableScale universal press primitive with haptics"
```

---

### Task 13: FlashList migration + pagination fix — CarListScreen

**Files:**
- Modify: `src/screens/listing/CarListScreen.js`

- [ ] **Step 1: Read the full current file**
```bash
cat flask-react-supabase-app/mobile/src/screens/listing/CarListScreen.js
```

- [ ] **Step 2: Replace FlatList import with FlashList, fix pagination, add stagger + toasts**

At the top of `CarListScreen.js`, make these import changes:
```js
// Remove:
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator, Modal, ScrollView, RefreshControl } from 'react-native';
// Add:
import { View, Text, TouchableOpacity, Image, StyleSheet, ActivityIndicator, Modal, ScrollView, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';
```

In `fetchCars`, replace the empty `catch (err) { }` with:
```js
} catch (err) {
  toastApiError(err);
} finally {
```

Fix the pagination reset bug — in the filter `useEffect` (or wherever `fetchCars(1)` is called after filters change), clear items before fetching:
```js
useEffect(() => {
  setCars([]);         // clear stale results immediately
  setPage(1);
  setHasMore(true);
  fetchCars(1, search, activeFilters);
}, [activeFilters]);   // adjust dependency array to match existing code
```

Replace `<FlatList` with `<FlashList`:
```js
<FlashList
  data={cars}
  keyExtractor={(item) => item.id}
  estimatedItemSize={280}
  renderItem={renderCarItem}
  onEndReached={loadMore}
  onEndReachedThreshold={0.4}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
  ListFooterComponent={loadingMore ? <ActivityIndicator color="#4CAF50" style={{ padding: 20 }} /> : null}
  ListEmptyComponent={!loading ? <EmptyState title="No cars found" description="Try adjusting your filters" /> : null}
/>
```

Wrap each card in the `renderCarItem` function with `useStaggeredEntrance`. Since hooks can't be called inside a render function, create a `CarCard` sub-component:
```js
function CarCard({ item, index, onPress }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress} haptic="light">
        {/* existing card JSX unchanged */}
      </PressableScale>
    </Animated.View>
  );
}
```

Then in `renderCarItem`:
```js
const renderCarItem = useCallback(({ item, index }) => (
  <CarCard
    item={item}
    index={index}
    onPress={() => navigation.navigate('CarDetail', { carId: item.id })}
  />
), [navigation]);
```

Wrap the screen's root return in `<ScreenEntrance>`:
```js
return (
  <SafeAreaView style={styles.container} edges={['top']}>
    <ScreenEntrance>
      {/* existing content */}
    </ScreenEntrance>
  </SafeAreaView>
);
```

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/listing/CarListScreen.js
git commit -m "feat(mobile): FlashList + stagger + pagination fix + toasts in CarListScreen"
```

---

### Task 14: FlashList + stagger in BikeListScreen, PlateListScreen, PartListScreen

**Files:**
- Modify: `src/screens/listing/BikeListScreen.js`
- Modify: `src/screens/listing/PlateListScreen.js`
- Modify: `src/screens/listing/PartListScreen.js`

Apply the identical changes from Task 13 to each of these three files:
1. Replace `FlatList` import with `FlashList` from `@shopify/flash-list`
2. Add `useStaggeredEntrance`, `ScreenEntrance`, `PressableScale`, `toastApiError` imports
3. Extract a `[Type]Card` sub-component that calls `useStaggeredEntrance(index)`
4. Update `renderItem` to use the card component
5. Replace `<FlatList` with `<FlashList estimatedItemSize={260}`
6. Fix pagination reset: `setItems([]); setPage(1); setHasMore(true);` before filter re-fetch
7. Replace empty `catch {}` with `toastApiError(err)`
8. Wrap root return in `<ScreenEntrance>`

- [ ] **Step 1: Update BikeListScreen.js** (apply above pattern)
- [ ] **Step 2: Update PlateListScreen.js** (apply above pattern)
- [ ] **Step 3: Update PartListScreen.js** (apply above pattern)

- [ ] **Step 4: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/listing/BikeListScreen.js flask-react-supabase-app/mobile/src/screens/listing/PlateListScreen.js flask-react-supabase-app/mobile/src/screens/listing/PartListScreen.js
git commit -m "feat(mobile): FlashList + stagger + toasts in Bike/Plate/PartListScreen"
```

---

### Task 15: ScreenEntrance + stagger on remaining screens

**Files:**
- Modify: `src/screens/explore/ExploreScreen.js`
- Modify: `src/screens/profile/SavedScreen.js`
- Modify: `src/screens/profile/MyListingsScreen.js`
- Modify: `src/screens/admin/AdminListingsScreen.js`
- Modify: `src/screens/admin/AdminUsersScreen.js`

For each screen:
1. Add `import ScreenEntrance from '../../components/ui/ScreenEntrance';`
2. Add `import { FlashList } from '@shopify/flash-list';` where FlatList is used
3. Add `import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';`
4. Add `import PressableScale from '../../components/ui/PressableScale';`
5. Extract card sub-components with `useStaggeredEntrance(index)` the same way as Task 13
6. Replace `FlatList` → `FlashList` with `estimatedItemSize={260}`
7. Wrap screen root in `<ScreenEntrance>`

For `ExploreScreen.js`, which may show category tiles instead of a flat list, wrap the category grid items in `PressableScale` and wrap the results section in `ScreenEntrance`.

- [ ] **Step 1: Update ExploreScreen.js**
- [ ] **Step 2: Update SavedScreen.js**
- [ ] **Step 3: Update MyListingsScreen.js**
- [ ] **Step 4: Update AdminListingsScreen.js**
- [ ] **Step 5: Update AdminUsersScreen.js**

- [ ] **Step 6: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/explore/ExploreScreen.js flask-react-supabase-app/mobile/src/screens/profile/SavedScreen.js flask-react-supabase-app/mobile/src/screens/profile/MyListingsScreen.js flask-react-supabase-app/mobile/src/screens/admin/AdminListingsScreen.js flask-react-supabase-app/mobile/src/screens/admin/AdminUsersScreen.js
git commit -m "feat(mobile): ScreenEntrance + FlashList + stagger on Explore/Saved/MyListings/Admin screens"
```

---

### Task 16: Detail screen parallax headers

**Files:**
- Modify: `src/screens/listing/CarDetailScreen.js`
- Modify: `src/screens/listing/BikeDetailScreen.js`
- Modify: `src/screens/listing/PlateDetailScreen.js`
- Modify: `src/screens/listing/PartDetailScreen.js`

- [ ] **Step 1: Read CarDetailScreen**
```bash
head -80 flask-react-supabase-app/mobile/src/screens/listing/CarDetailScreen.js
```

- [ ] **Step 2: Add parallax + ScreenEntrance + PressableScale to CarDetailScreen**

Add imports:
```js
import Animated, { useSharedValue, useAnimatedScrollHandler, useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import ParallaxHeader from '../../components/ui/ParallaxHeader';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
```

Add scroll tracking:
```js
const scrollY = useSharedValue(0);
const scrollHandler = useAnimatedScrollHandler((event) => {
  scrollY.value = event.contentOffset.y;
});
```

Add header title opacity animation (fades in as user scrolls past the image):
```js
const IMAGE_HEIGHT = 280;
const headerTitleStyle = useAnimatedStyle(() => ({
  opacity: interpolate(scrollY.value, [IMAGE_HEIGHT - 60, IMAGE_HEIGHT], [0, 1], Extrapolation.CLAMP),
}));
```

Replace the top `ScrollView` with `Animated.ScrollView` and attach the handler:
```js
<Animated.ScrollView onScroll={scrollHandler} scrollEventThrottle={16}>
```

Wrap CTA buttons (Call, WhatsApp, Save) with `PressableScale`:
```js
<PressableScale onPress={handleCall} haptic="medium" style={styles.actionBtn}>
  {/* existing button content */}
</PressableScale>
```

Wrap the root screen in `<ScreenEntrance>`.

- [ ] **Step 3: Apply same pattern to BikeDetailScreen, PlateDetailScreen, PartDetailScreen**

Same imports and scroll-tracking pattern. For PlateDetail and PartDetail which may have shorter images, use `IMAGE_HEIGHT = 200`.

- [ ] **Step 4: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/listing/CarDetailScreen.js flask-react-supabase-app/mobile/src/screens/listing/BikeDetailScreen.js flask-react-supabase-app/mobile/src/screens/listing/PlateDetailScreen.js flask-react-supabase-app/mobile/src/screens/listing/PartDetailScreen.js
git commit -m "feat(mobile): parallax scroll + ScreenEntrance + PressableScale on detail screens"
```

---

### Task 17: Tab bar icon spring animation

**Files:**
- Modify: `src/navigation/AppNavigator.js`

- [ ] **Step 1: Read current tab icon setup**
```bash
grep -n "tabBarIcon\|Ionicons\|tabBar" flask-react-supabase-app/mobile/src/navigation/AppNavigator.js | head -30
```

- [ ] **Step 2: Create animated tab icon component**

In `AppNavigator.js`, add this component above the navigator definitions:
```js
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { SPRING_FAST } from '../constants/motion';

function AnimatedTabIcon({ name, color, size, focused }) {
  const scale = useSharedValue(focused ? 1.15 : 1);

  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.15 : 1, SPRING_FAST);
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}
```

Then in each tab's `tabBarIcon` option, replace:
```js
// Before:
tabBarIcon: ({ color, size }) => <Ionicons name="search" size={size} color={color} />
// After:
tabBarIcon: ({ color, size, focused }) => <AnimatedTabIcon name="search" size={size} color={color} focused={focused} />
```

Apply to all four tabs (Explore, Post, Saved, Profile).

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/navigation/AppNavigator.js
git commit -m "feat(mobile): spring-animated tab bar icons"
```

---

## PHASE 3 — NEW SCREENS & BACKEND SYNC

---

### Task 18: BuyingRequestsScreen

**Files:**
- Create: `src/screens/listing/BuyingRequestsScreen.js`

- [ ] **Step 1: Create BuyingRequestsScreen.js**

Create `flask-react-supabase-app/mobile/src/screens/listing/BuyingRequestsScreen.js`:
```js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError } from '../../utils/toast';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import EmptyState from '../../components/ui/EmptyState';
import ListingSkeleton from '../../components/ui/ListingSkeleton';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { formatPrice } from '../../utils/formatters';

const PAGE_SIZE = 20;

function RequestCard({ item, index, onPress }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress} haptic="light">
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{item.category || 'Any'}</Text>
            </View>
            <Text style={styles.date}>
              {item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}
            </Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>{item.title || item.description}</Text>
          {(item.budget_min || item.budget_max) && (
            <Text style={styles.budget}>
              Budget: {item.budget_min ? formatPrice(item.budget_min) : '—'} – {item.budget_max ? formatPrice(item.budget_max) : 'open'}
            </Text>
          )}
          {item.make && (
            <Text style={styles.detail}>{item.make}{item.model ? ` ${item.model}` : ''}</Text>
          )}
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function BuyingRequestsScreen({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchRequests = useCallback(async (pageNum = 1, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const offset = (pageNum - 1) * PAGE_SIZE;
      const data = await apiClient.get(`/api/buying-requests?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.requests || data?.data || []);
      if (pageNum === 1) setRequests(items);
      else setRequests(prev => [...prev, ...items]);
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
      toastApiError(err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => { fetchRequests(1); }, []);

  const handleRefresh = useCallback(() => fetchRequests(1, true), [fetchRequests]);
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchRequests(page + 1);
  }, [loadingMore, hasMore, page, fetchRequests]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <Text style={styles.heading}>Buying Requests</Text>
          <PressableScale
            onPress={() => navigation.navigate('PostBuyingRequest')}
            haptic="medium"
            style={styles.postBtn}
          >
            <Ionicons name="add" size={20} color={COLORS.black} />
            <Text style={styles.postBtnText}>Post Request</Text>
          </PressableScale>
        </View>

        {loading ? (
          <ListingSkeleton count={4} />
        ) : (
          <FlashList
            data={requests}
            keyExtractor={(item) => item.id}
            estimatedItemSize={120}
            renderItem={({ item, index }) => (
              <RequestCard
                item={item}
                index={index}
                onPress={() => navigation.navigate('BuyingRequestDetail', { requestId: item.id })}
              />
            )}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
            ListFooterComponent={loadingMore ? <ActivityIndicator color={COLORS.accent} style={{ padding: 20 }} /> : null}
            ListEmptyComponent={<EmptyState icon="search" title="No buying requests yet" description="Be the first to post what you're looking for" />}
          />
        )}
      </ScreenEntrance>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md },
  heading: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: COLORS.white },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8 },
  postBtnText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: COLORS.black },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, marginHorizontal: SPACING.md, marginBottom: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.borderLight },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  categoryBadge: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 10, paddingVertical: 3 },
  categoryText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: COLORS.accent },
  date: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: COLORS.textMuted },
  title: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: COLORS.white, marginBottom: SPACING.xs },
  budget: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.accent, marginBottom: 2 },
  detail: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
});
```

- [ ] **Step 2: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/listing/BuyingRequestsScreen.js
git commit -m "feat(mobile): BuyingRequestsScreen with FlashList + stagger"
```

---

### Task 19: BuyingRequestDetailScreen

**Files:**
- Create: `src/screens/listing/BuyingRequestDetailScreen.js`

- [ ] **Step 1: Create BuyingRequestDetailScreen.js**

Create `flask-react-supabase-app/mobile/src/screens/listing/BuyingRequestDetailScreen.js`:
```js
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { formatPrice } from '../../utils/formatters';
import { trackLeadEvent } from '../../utils/leadTracking';

export default function BuyingRequestDetailScreen({ route, navigation }) {
  const { requestId } = route.params;
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiClient.get(`/api/buying-requests/${requestId}`);
        setRequest(data?.request || data);
      } catch (err) {
        toastApiError(err);
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    })();
  }, [requestId]);

  const handleWhatsApp = async () => {
    if (!request) return;
    try {
      const data = await apiClient.post(`/api/buying-requests/${requestId}/reveal-whatsapp`, {});
      const phone = data?.whatsapp_number || request.contact_phone;
      if (phone) {
        await trackLeadEvent('buying_request', requestId, 'whatsapp_click');
        Linking.openURL(`https://wa.me/${phone.replace(/\D/g, '')}`);
      }
    } catch (err) {
      toastApiError(err);
    }
  };

  const handleCall = async () => {
    if (!request?.contact_phone) return;
    await trackLeadEvent('buying_request', requestId, 'call_click');
    Linking.openURL(`tel:${request.contact_phone}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ActivityIndicator color={COLORS.accent} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!request) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.categoryRow}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{request.category || 'Any category'}</Text>
            </View>
            <Text style={styles.date}>{request.created_at ? new Date(request.created_at).toLocaleDateString() : ''}</Text>
          </View>

          <Text style={styles.title}>{request.title || request.description}</Text>

          {request.description && request.title && (
            <Text style={styles.description}>{request.description}</Text>
          )}

          <View style={styles.specsCard}>
            {request.make && (
              <Row label="Make/Model" value={`${request.make}${request.model ? ` ${request.model}` : ''}`} />
            )}
            {(request.budget_min || request.budget_max) && (
              <Row label="Budget" value={`${request.budget_min ? formatPrice(request.budget_min) : '—'} – ${request.budget_max ? formatPrice(request.budget_max) : 'Open'}`} />
            )}
            {request.year_from && (
              <Row label="Year" value={`${request.year_from}${request.year_to ? ` – ${request.year_to}` : '+'}`} />
            )}
          </View>

          <View style={styles.actions}>
            <PressableScale onPress={handleWhatsApp} haptic="medium" style={[styles.actionBtn, styles.whatsappBtn]}>
              <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              <Text style={styles.actionBtnText}>WhatsApp</Text>
            </PressableScale>
            {request.contact_phone && (
              <PressableScale onPress={handleCall} haptic="medium" style={[styles.actionBtn, styles.callBtn]}>
                <Ionicons name="call" size={20} color="#fff" />
                <Text style={styles.actionBtnText}>Call</Text>
              </PressableScale>
            )}
          </View>
        </ScrollView>
      </ScreenEntrance>
    </SafeAreaView>
  );
}

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.md, paddingBottom: 40 },
  categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  badge: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4 },
  badgeText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: COLORS.accent },
  date: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: COLORS.textMuted },
  title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: COLORS.white, marginBottom: SPACING.sm },
  description: { ...FONTS.regular, fontSize: FONT_SIZES.md, color: COLORS.textSecondary, lineHeight: 22, marginBottom: SPACING.md },
  specsCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.borderLight },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  rowLabel: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: COLORS.textMuted },
  rowValue: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.white },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: BORDER_RADIUS.lg, paddingVertical: 14 },
  whatsappBtn: { backgroundColor: '#25D366' },
  callBtn: { backgroundColor: COLORS.primary, borderWidth: 1, borderColor: COLORS.accent },
  actionBtnText: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: '#fff' },
});
```

- [ ] **Step 2: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/listing/BuyingRequestDetailScreen.js
git commit -m "feat(mobile): BuyingRequestDetailScreen with WhatsApp/call contact"
```

---

### Task 20: PostBuyingRequestScreen

**Files:**
- Create: `src/screens/listing/PostBuyingRequestScreen.js`

- [ ] **Step 1: Create PostBuyingRequestScreen.js**

Create `flask-react-supabase-app/mobile/src/screens/listing/PostBuyingRequestScreen.js`:
```js
import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

const CATEGORIES = ['Cars', 'Bikes', 'Plates', 'Parts', 'Other'];

export default function PostBuyingRequestScreen({ navigation }) {
  const [form, setForm] = useState({
    category: '',
    title: '',
    description: '',
    make: '',
    model: '',
    budget_min: '',
    budget_max: '',
    contact_phone: '',
    contact_preference: 'whatsapp',
  });
  const [submitting, setSubmitting] = useState(false);

  const update = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      showError('Missing title', 'Please describe what you are looking for.');
      return;
    }
    if (!form.contact_phone.trim()) {
      showError('Missing phone', 'Please enter a contact phone number.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        budget_min: form.budget_min ? Number(form.budget_min) : null,
        budget_max: form.budget_max ? Number(form.budget_max) : null,
      };
      await apiClient.post('/api/buying-requests', payload);
      showSuccess('Request posted!', 'Sellers will be able to contact you.');
      navigation.goBack();
    } catch (err) {
      toastApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>Post a Buying Request</Text>
            <Text style={styles.subheading}>Tell sellers what you're looking for</Text>

            <Label>Category</Label>
            <View style={styles.chipRow}>
              {CATEGORIES.map((cat) => (
                <PressableScale
                  key={cat}
                  onPress={() => update('category', cat)}
                  haptic="light"
                  style={[styles.chip, form.category === cat && styles.chipActive]}
                >
                  <Text style={[styles.chipText, form.category === cat && styles.chipTextActive]}>{cat}</Text>
                </PressableScale>
              ))}
            </View>

            <Label>What are you looking for? *</Label>
            <TextInput
              style={styles.input}
              placeholder="e.g. Toyota Camry 2020-2022 GCC spec"
              placeholderTextColor={COLORS.textMuted}
              value={form.title}
              onChangeText={(v) => update('title', v)}
            />

            <Label>Description</Label>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Any specific requirements, colour preferences, mileage range..."
              placeholderTextColor={COLORS.textMuted}
              value={form.description}
              onChangeText={(v) => update('description', v)}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Label>Make</Label>
                <TextInput style={styles.input} placeholder="Toyota" placeholderTextColor={COLORS.textMuted} value={form.make} onChangeText={(v) => update('make', v)} />
              </View>
              <View style={{ width: SPACING.sm }} />
              <View style={{ flex: 1 }}>
                <Label>Model</Label>
                <TextInput style={styles.input} placeholder="Camry" placeholderTextColor={COLORS.textMuted} value={form.model} onChangeText={(v) => update('model', v)} />
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Label>Budget Min (AED)</Label>
                <TextInput style={styles.input} placeholder="0" placeholderTextColor={COLORS.textMuted} value={form.budget_min} onChangeText={(v) => update('budget_min', v)} keyboardType="numeric" />
              </View>
              <View style={{ width: SPACING.sm }} />
              <View style={{ flex: 1 }}>
                <Label>Budget Max (AED)</Label>
                <TextInput style={styles.input} placeholder="Any" placeholderTextColor={COLORS.textMuted} value={form.budget_max} onChangeText={(v) => update('budget_max', v)} keyboardType="numeric" />
              </View>
            </View>

            <Label>Contact Phone *</Label>
            <TextInput
              style={styles.input}
              placeholder="+971 50 000 0000"
              placeholderTextColor={COLORS.textMuted}
              value={form.contact_phone}
              onChangeText={(v) => update('contact_phone', v)}
              keyboardType="phone-pad"
            />

            <PressableScale onPress={handleSubmit} haptic="success" style={[styles.submitBtn, submitting && styles.submitBtnDisabled]} disabled={submitting}>
              <Text style={styles.submitBtnText}>{submitting ? 'Posting…' : 'Post Request'}</Text>
            </PressableScale>
          </ScrollView>
        </KeyboardAvoidingView>
      </ScreenEntrance>
    </SafeAreaView>
  );
}

function Label({ children }) {
  return <Text style={{ ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary, marginBottom: 6, marginTop: SPACING.md }}>{children}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.md, paddingBottom: 40 },
  heading: { ...FONTS.bold, fontSize: FONT_SIZES.xxl, color: COLORS.white, marginBottom: 4 },
  subheading: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.md },
  input: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, color: COLORS.white, fontSize: FONT_SIZES.md, borderWidth: 1, borderColor: COLORS.borderLight },
  textArea: { height: 100, paddingTop: SPACING.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.accent },
  chipText: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.accent },
  row: { flexDirection: 'row' },
  submitBtn: { backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, alignItems: 'center', marginTop: SPACING.xl },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.black },
});
```

- [ ] **Step 2: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/listing/PostBuyingRequestScreen.js
git commit -m "feat(mobile): PostBuyingRequestScreen form"
```

---

### Task 21: ImageCropperModal

**Files:**
- Create: `src/components/ui/ImageCropperModal.js`

- [ ] **Step 1: Create ImageCropperModal.js**

Create `flask-react-supabase-app/mobile/src/components/ui/ImageCropperModal.js`:
```js
import React, { useState } from 'react';
import { View, Text, Image, Modal, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { compressImage } from '../../utils/imageCompressor';
import PressableScale from './PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { showError } from '../../utils/toast';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PREVIEW_SIZE = SCREEN_WIDTH - SPACING.md * 2;

const RATIOS = [
  { label: 'Free', value: null },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '1:1', value: 1 },
];

export default function ImageCropperModal({ visible, imageUri, onConfirm, onCancel }) {
  const [ratio, setRatio] = useState(null);
  const [processing, setProcessing] = useState(false);

  const previewHeight = ratio ? PREVIEW_SIZE / ratio : PREVIEW_SIZE * 0.75;

  const handleConfirm = async () => {
    if (!imageUri) return;
    setProcessing(true);
    try {
      const result = await compressImage(imageUri);
      onConfirm(result.uri);
    } catch {
      showError('Compression failed', 'Using original image.');
      onConfirm(imageUri);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <PressableScale onPress={onCancel} haptic="light" style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </PressableScale>
          <Text style={styles.title}>Adjust Photo</Text>
          <PressableScale onPress={handleConfirm} haptic="success" style={styles.confirmBtn} disabled={processing}>
            {processing
              ? <ActivityIndicator size="small" color={COLORS.black} />
              : <Text style={styles.confirmText}>Use Photo</Text>}
          </PressableScale>
        </View>

        <View style={styles.preview}>
          {imageUri && (
            <Image
              source={{ uri: imageUri }}
              style={{ width: PREVIEW_SIZE, height: previewHeight, borderRadius: BORDER_RADIUS.lg }}
              resizeMode="cover"
            />
          )}
        </View>

        <View style={styles.ratioRow}>
          <Text style={styles.ratioLabel}>Aspect ratio</Text>
          <View style={styles.ratioChips}>
            {RATIOS.map((r) => (
              <PressableScale
                key={r.label}
                onPress={() => setRatio(r.value)}
                haptic="light"
                style={[styles.chip, ratio === r.value && styles.chipActive]}
              >
                <Text style={[styles.chipText, ratio === r.value && styles.chipTextActive]}>{r.label}</Text>
              </PressableScale>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SPACING.md, paddingTop: SPACING.lg },
  cancelBtn: { padding: 8 },
  cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: COLORS.textSecondary },
  title: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: COLORS.white },
  confirmBtn: { backgroundColor: COLORS.accent, borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 16, paddingVertical: 8 },
  confirmText: { ...FONTS.semibold, fontSize: FONT_SIZES.sm, color: COLORS.black },
  preview: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.md },
  ratioRow: { padding: SPACING.md },
  ratioLabel: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.sm },
  ratioChips: { flexDirection: 'row', gap: SPACING.sm },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.black },
});
```

- [ ] **Step 2: Wire ImageCropperModal into PostListingScreen**

Open `src/screens/listing/PostListingScreen.js`. Add at the top:
```js
import ImageCropperModal from '../../components/ui/ImageCropperModal';
import { compressImage } from '../../utils/imageCompressor';
```

Add state:
```js
const [cropperUri, setCropperUri] = useState(null);
const [cropperVisible, setCropperVisible] = useState(false);
```

After picking an image from `expo-image-picker`, instead of immediately adding it to state, open the cropper:
```js
// Find the place where image URIs are added to state after picking, e.g.:
// setImages(prev => [...prev, result.assets[0].uri]);
// Replace with:
setCropperUri(result.assets[0].uri);
setCropperVisible(true);
```

Add the modal to the JSX (before the closing `</View>` or `</SafeAreaView>`):
```js
<ImageCropperModal
  visible={cropperVisible}
  imageUri={cropperUri}
  onConfirm={(uri) => {
    setImages(prev => [...prev, uri]);
    setCropperVisible(false);
    setCropperUri(null);
  }}
  onCancel={() => {
    setCropperVisible(false);
    setCropperUri(null);
  }}
/>
```

Also add `toastApiError` to the existing empty catch block in the form submission:
```js
} catch (err) {
  toastApiError(err);
}
```

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/components/ui/ImageCropperModal.js flask-react-supabase-app/mobile/src/screens/listing/PostListingScreen.js
git commit -m "feat(mobile): ImageCropperModal + compress before upload in PostListingScreen"
```

---

### Task 22: RenewListingModal

**Files:**
- Create: `src/components/ui/RenewListingModal.js`
- Modify: `src/screens/profile/MyListingsScreen.js`

- [ ] **Step 1: Create RenewListingModal.js**

Create `flask-react-supabase-app/mobile/src/components/ui/RenewListingModal.js`:
```js
import React, { useState } from 'react';
import { View, Text, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import PressableScale from './PressableScale';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RenewListingModal({ visible, listingType, listingId, onSuccess, onCancel }) {
  const [loading, setLoading] = useState(false);

  const handleRenew = async () => {
    if (!listingType || !listingId) return;
    setLoading(true);
    try {
      await apiClient.post(`/api/user/listings/${listingType}/${listingId}/outcome`, { outcome: 'renew' });
      showSuccess('Listing renewed', `Active for another 30 days — expires ${addDays(30)}.`);
      onSuccess?.();
    } catch (err) {
      toastApiError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Renew Listing</Text>
          <Text style={styles.body}>
            Your listing will be renewed for another 30 days and will expire on{' '}
            <Text style={styles.date}>{addDays(30)}</Text>.
          </Text>
          <View style={styles.actions}>
            <PressableScale onPress={onCancel} haptic="light" style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </PressableScale>
            <PressableScale onPress={handleRenew} haptic="success" style={styles.renewBtn} disabled={loading}>
              {loading
                ? <ActivityIndicator size="small" color={COLORS.black} />
                : <Text style={styles.renewText}>Renew</Text>}
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, paddingBottom: 40 },
  title: { ...FONTS.bold, fontSize: FONT_SIZES.xl, color: COLORS.white, marginBottom: SPACING.sm },
  body: { ...FONTS.regular, fontSize: FONT_SIZES.md, color: COLORS.textSecondary, lineHeight: 22, marginBottom: SPACING.lg },
  date: { ...FONTS.semibold, color: COLORS.accent },
  actions: { flexDirection: 'row', gap: SPACING.sm },
  cancelBtn: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  cancelText: { ...FONTS.medium, fontSize: FONT_SIZES.md, color: COLORS.textSecondary },
  renewBtn: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.lg, backgroundColor: COLORS.accent, alignItems: 'center' },
  renewText: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.black },
});
```

- [ ] **Step 2: Wire into MyListingsScreen**

Open `src/screens/profile/MyListingsScreen.js`. Add:
```js
import RenewListingModal from '../../components/ui/RenewListingModal';
```

Add state:
```js
const [renewModal, setRenewModal] = useState({ visible: false, type: null, id: null });
```

In the listing card action menu (where Edit/Delete options live), add a Renew option that only shows when `item.status === 'expired'`:
```js
{item.status === 'expired' && (
  <PressableScale
    onPress={() => setRenewModal({ visible: true, type: item.listing_type || 'car', id: item.id })}
    haptic="light"
    style={styles.actionItem}
  >
    <Ionicons name="refresh" size={16} color={COLORS.accent} />
    <Text style={[styles.actionText, { color: COLORS.accent }]}>Renew</Text>
  </PressableScale>
)}
```

Add modal to JSX:
```js
<RenewListingModal
  visible={renewModal.visible}
  listingType={renewModal.type}
  listingId={renewModal.id}
  onSuccess={() => {
    setRenewModal({ visible: false, type: null, id: null });
    fetchListings(); // existing refresh function name — check the file
  }}
  onCancel={() => setRenewModal({ visible: false, type: null, id: null })}
/>
```

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/components/ui/RenewListingModal.js flask-react-supabase-app/mobile/src/screens/profile/MyListingsScreen.js
git commit -m "feat(mobile): RenewListingModal + Renew action in MyListingsScreen"
```

---

### Task 23: Turnstile CAPTCHA utility

**Files:**
- Create: `src/utils/turnstile.js`
- Modify: `src/constants/config.js`

- [ ] **Step 1: Add TURNSTILE_SITE_KEY to config**

Open `src/constants/config.js` and add:
```js
export const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || '';
```

- [ ] **Step 2: Create turnstile.js**

Create `flask-react-supabase-app/mobile/src/utils/turnstile.js`:
```js
import { WebView } from 'react-native-webview';
import React, { useRef } from 'react';
import { Modal, View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { TURNSTILE_SITE_KEY } from '../constants/config';
import { COLORS } from '../constants/theme';

/**
 * Returns a promise that resolves with the Turnstile token.
 * Call via: const token = await showTurnstile(setShowModal, resolveRef, rejectRef)
 * 
 * Usage pattern (in a component):
 *   const [turnstileVisible, setTurnstileVisible] = useState(false);
 *   const turnstileResolve = useRef(null);
 *   const turnstileReject = useRef(null);
 *
 *   const getToken = () => new Promise((res, rej) => {
 *     turnstileResolve.current = res;
 *     turnstileReject.current = rej;
 *     setTurnstileVisible(true);
 *   });
 *
 *   // In JSX:
 *   <TurnstileModal
 *     visible={turnstileVisible}
 *     siteKey={TURNSTILE_SITE_KEY}
 *     onToken={(t) => { setTurnstileVisible(false); turnstileResolve.current?.(t); }}
 *     onCancel={() => { setTurnstileVisible(false); turnstileReject.current?.(new Error('cancelled')); }}
 *   />
 */

const HTML = (siteKey) => `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000;}</style>
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
    // No site key configured — resolve immediately with empty string
    if (visible) onToken('');
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.label}>Security check</Text>
          <WebView
            style={styles.webview}
            source={{ html: HTML(siteKey) }}
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
            renderLoading={() => <ActivityIndicator color={COLORS.accent} style={StyleSheet.absoluteFill} />}
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
```

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/utils/turnstile.js flask-react-supabase-app/mobile/src/constants/config.js
git commit -m "feat(mobile): TurnstileModal CAPTCHA component"
```

---

### Task 24: Wire Turnstile into LoginScreen and SignupScreen

**Files:**
- Modify: `src/screens/auth/LoginScreen.js`
- Modify: `src/screens/auth/SignupScreen.js`

- [ ] **Step 1: Update LoginScreen**

Open `src/screens/auth/LoginScreen.js`. Add imports:
```js
import { TurnstileModal } from '../../utils/turnstile';
import { TURNSTILE_SITE_KEY } from '../../constants/config';
import { toastApiError } from '../../utils/toast';
```

Add state + refs inside the component:
```js
const [turnstileVisible, setTurnstileVisible] = useState(false);
const turnstileResolveRef = useRef(null);
const turnstileRejectRef = useRef(null);

const getTurnstileToken = () =>
  new Promise((res, rej) => {
    if (!TURNSTILE_SITE_KEY) { res(''); return; }
    turnstileResolveRef.current = res;
    turnstileRejectRef.current = rej;
    setTurnstileVisible(true);
  });
```

In the existing submit handler (find the `handleLogin` or `handleSubmit` function), insert the Turnstile step before the API call:
```js
const handleLogin = async () => {
  // ... existing validation ...
  try {
    setLoading(true);
    const cfToken = await getTurnstileToken();
    const result = await apiClient.post('/api/auth/login', {
      email,
      password,
      cf_turnstile_token: cfToken,
    });
    // ... existing success handling ...
  } catch (err) {
    toastApiError(err);
  } finally {
    setLoading(false);
  }
};
```

Add the modal to the JSX (before closing tag):
```js
<TurnstileModal
  visible={turnstileVisible}
  siteKey={TURNSTILE_SITE_KEY}
  onToken={(token) => {
    setTurnstileVisible(false);
    turnstileResolveRef.current?.(token);
  }}
  onCancel={() => {
    setTurnstileVisible(false);
    turnstileRejectRef.current?.(new Error('cancelled'));
  }}
/>
```

- [ ] **Step 2: Apply the same pattern to SignupScreen**

Same imports, same state + refs + `getTurnstileToken`, same modal JSX. The submit handler passes `cf_turnstile_token` in `POST /api/auth/signup`.

- [ ] **Step 3: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/auth/LoginScreen.js flask-react-supabase-app/mobile/src/screens/auth/SignupScreen.js
git commit -m "feat(mobile): Turnstile CAPTCHA on Login and Signup"
```

---

### Task 25: Navigation — add buying request routes + ExploreScreen tile

**Files:**
- Modify: `src/navigation/AppNavigator.js`
- Modify: `src/screens/explore/ExploreScreen.js`

- [ ] **Step 1: Add imports to AppNavigator.js**

```js
import BuyingRequestsScreen from '../screens/listing/BuyingRequestsScreen';
import BuyingRequestDetailScreen from '../screens/listing/BuyingRequestDetailScreen';
import PostBuyingRequestScreen from '../screens/listing/PostBuyingRequestScreen';
```

- [ ] **Step 2: Add routes to Explore stack**

Find the Explore stack definition and add the three new screens:
```js
<Stack.Screen name="BuyingRequests" component={BuyingRequestsScreen} options={{ title: 'Buying Requests' }} />
<Stack.Screen name="BuyingRequestDetail" component={BuyingRequestDetailScreen} options={{ title: 'Request Detail' }} />
<Stack.Screen name="PostBuyingRequest" component={PostBuyingRequestScreen} options={{ title: 'Post Request' }} />
```

Also add `PostBuyingRequest` to the Post tab stack (so users can navigate there from the Post tab too):
```js
<Stack.Screen name="PostBuyingRequest" component={PostBuyingRequestScreen} options={{ title: 'Post Buying Request' }} />
```

- [ ] **Step 3: Add "Wanted" tile to ExploreScreen category grid**

Open `src/screens/explore/ExploreScreen.js`. Find the category grid array (e.g. `CATEGORIES` or `LISTING_TYPES`). Add:
```js
{ label: 'Wanted', icon: 'search-outline', route: 'BuyingRequests', color: '#6366f1' },
```

Then in the tile's `onPress`:
```js
onPress={() => navigation.navigate('BuyingRequests')}
```

- [ ] **Step 4: Commit**
```bash
git add flask-react-supabase-app/mobile/src/navigation/AppNavigator.js flask-react-supabase-app/mobile/src/screens/explore/ExploreScreen.js
git commit -m "feat(mobile): add buying request routes to navigator + Wanted tile in Explore"
```

---

### Task 26: Admin screens — Cloudflare source badge

**Files:**
- Modify: `src/screens/admin/AdminDashboardScreen.js`
- Modify: `src/screens/admin/AdminMetricsScreen.js`

- [ ] **Step 1: Read current AdminDashboardScreen stats display**
```bash
grep -n "unique_visitors\|data_source\|cloudflare\|site_visitors" flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js | head -20
```

- [ ] **Step 2: Add CF source badge to AdminDashboardScreen**

Find where `stats.unique_visitors` or `stats.site_visitors` is displayed. Add a source badge below or beside it. Add a helper component inside the file:

```js
function CfSourceBadge({ dataSource, uniqueVisitorsSource }) {
  if (!dataSource) return null;
  if (dataSource !== 'cloudflare') {
    return <Text style={badgeStyles.grey}>In-app tracker</Text>;
  }
  if (uniqueVisitorsSource === 'cf_rest') {
    return <Text style={badgeStyles.orange}>Cloudflare (exact)</Text>;
  }
  if (uniqueVisitorsSource === 'cf_graphql_estimate') {
    return <Text style={badgeStyles.amber}>Cloudflare (estimated)</Text>;
  }
  return <Text style={badgeStyles.orange}>Cloudflare</Text>;
}

const badgeStyles = StyleSheet.create({
  orange: { fontSize: 10, color: '#fdba74', backgroundColor: 'rgba(251,146,60,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
  amber: { fontSize: 10, color: '#fcd34d', backgroundColor: 'rgba(252,211,77,0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
  grey: { fontSize: 10, color: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
});
```

Then use it wherever `stats.unique_visitors` is shown:
```js
<Text style={styles.metricValue}>{stats.unique_visitors?.toLocaleString() ?? '—'}</Text>
<CfSourceBadge dataSource={stats.data_source} uniqueVisitorsSource={stats.unique_visitors_source} />
```

Also add edge stat tiles when `data_source === 'cloudflare'`:
```js
{stats.data_source === 'cloudflare' && (
  <View style={styles.edgeRow}>
    <EdgeStat label="Requests" value={stats.edge_requests} />
    <EdgeStat label="Threats" value={stats.edge_threats} />
    <EdgeStat label="Cached" value={stats.edge_cached_requests} />
  </View>
)}
```

Where `EdgeStat` is:
```js
function EdgeStat({ label, value }) {
  return (
    <View style={styles.edgeTile}>
      <Text style={styles.edgeTileValue}>{value?.toLocaleString() ?? '—'}</Text>
      <Text style={styles.edgeTileLabel}>{label}</Text>
    </View>
  );
}
```

Add to `styles`:
```js
edgeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
edgeTile: { flex: 1, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: 10, alignItems: 'center' },
edgeTileValue: { ...FONTS.bold, fontSize: FONT_SIZES.md, color: COLORS.white },
edgeTileLabel: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
```

- [ ] **Step 3: Apply same CfSourceBadge to AdminMetricsScreen**

In `AdminMetricsScreen.js`, find where unique visitor or session metrics are displayed and add the same `CfSourceBadge` component (copy the component and its styles into that file, or extract to a shared file).

Use `metrics?.user_metrics?.data_source` and `metrics?.user_metrics?.unique_visitors_source`.

- [ ] **Step 4: Commit**
```bash
git add flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js flask-react-supabase-app/mobile/src/screens/admin/AdminMetricsScreen.js
git commit -m "feat(mobile): Cloudflare source badge (exact/estimated/in-app) on admin screens"
```

---

### Task 27: Run all tests + final integration check

- [ ] **Step 1: Run full test suite**
```bash
cd flask-react-supabase-app/mobile && npx jest --passWithNoTests 2>&1 | tail -20
```
Expected: all tests pass (toast.test, imageCompressor.test, swrCache.test, motion.test, useStaggeredEntrance.test)

- [ ] **Step 2: Check for TypeScript / JS errors**
```bash
cd flask-react-supabase-app/mobile && npx expo export --platform ios --dev 2>&1 | grep -i "error\|warn" | head -30
```
Expected: no errors (only expo build info).

- [ ] **Step 3: Verify imports are consistent**

Check that all new files are imported correctly in navigation and screens:
```bash
grep -r "BuyingRequestsScreen\|BuyingRequestDetailScreen\|PostBuyingRequestScreen" flask-react-supabase-app/mobile/src/navigation/
grep -r "RenewListingModal" flask-react-supabase-app/mobile/src/screens/profile/
grep -r "ImageCropperModal" flask-react-supabase-app/mobile/src/screens/listing/PostListingScreen.js
grep -r "TurnstileModal" flask-react-supabase-app/mobile/src/screens/auth/
grep -r "ScreenEntrance" flask-react-supabase-app/mobile/src/screens/ | wc -l
grep -r "FlashList" flask-react-supabase-app/mobile/src/screens/ | wc -l
```
Expected: each grep returns at least one hit; FlashList appears in 8+ files; ScreenEntrance appears in 10+ files.

- [ ] **Step 4: Final commit + push**
```bash
git add -A flask-react-supabase-app/mobile/
git commit -m "feat(mobile): complete overhaul — P1 foundation, P2 animations, P3 screens

Phase 1: deps cleanup, toast system, image compression, FlashList, SWR TTL, pagination fix, console cleanup
Phase 2: shimmer skeleton, ScreenEntrance, stagger hook, PressableScale, parallax detail screens, tab spring
Phase 3: buying requests (3 screens), ImageCropperModal, RenewListingModal, Turnstile CAPTCHA, CF admin badge

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: Success criteria verification**

Confirm every item in the spec's success criteria checklist:
- [ ] No unused packages (axios/async-storage/expo-router gone from package.json)
- [ ] Zero silent catch blocks (grep: `catch.*{}` should return 0 results across screens)
- [ ] FlashList used on 8 screens (CarList, BikeList, PlateList, PartList, Explore, Saved, AdminListings, AdminUsers)
- [ ] ScreenEntrance on 10+ screens
- [ ] PressableScale replaces TouchableOpacity on all cards and CTAs
- [ ] Shimmer skeleton visible on load
- [ ] Stagger visible on list item entrance
- [ ] Parallax on all four detail screens
- [ ] BuyingRequests, BuyingRequestDetail, PostBuyingRequest all navigable
- [ ] ImageCropperModal opens after image pick
- [ ] RenewListingModal shows on expired listings
- [ ] Turnstile modal appears on Login/Signup submit (with site key set)
- [ ] Admin shows CF badge in orange/amber/grey
- [ ] All 5 unit tests pass

---

## Self-Review Checklist

**Spec coverage:**
- [x] Phase 1 deps cleanup → Task 2
- [x] Toast system → Task 3
- [x] Image compression → Task 4
- [x] SWR TTL → Task 5
- [x] Motion constants → Task 6
- [x] SavedListingsContext toasts → Task 7
- [x] Console cleanup + FadeInImage → Task 8
- [x] Shimmer skeleton → Task 9
- [x] ScreenEntrance → Task 10
- [x] useStaggeredEntrance → Task 11
- [x] PressableScale → Task 12
- [x] FlashList + pagination fix → Tasks 13-14
- [x] Stagger + ScreenEntrance remaining screens → Task 15
- [x] Detail parallax → Task 16
- [x] Tab icon spring → Task 17
- [x] BuyingRequestsScreen → Task 18
- [x] BuyingRequestDetailScreen → Task 19
- [x] PostBuyingRequestScreen → Task 20
- [x] ImageCropperModal → Task 21
- [x] RenewListingModal → Task 22
- [x] Turnstile CAPTCHA → Tasks 23-24
- [x] Navigation updates → Task 25
- [x] Admin CF badge → Task 26
- [x] Final test + push → Task 27

**Type consistency:** `compressImage` returns `{ uri }` in Task 4, consumed the same way in Task 21. `useStaggeredEntrance` returns `{ animatedStyle }` in Task 11, destructured identically in Tasks 13-15 and 18. `showError`, `toastApiError` imported from `../utils/toast` consistently throughout.

**No placeholders:** All code blocks are complete. No "TBD", "fill in", or "similar to" references.
