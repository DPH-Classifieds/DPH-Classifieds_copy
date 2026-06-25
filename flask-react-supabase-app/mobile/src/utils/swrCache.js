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
