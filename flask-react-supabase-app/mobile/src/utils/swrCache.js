import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'dph_swr:';

export const swrGet = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw);
    return { value, ageMs: Date.now() - savedAt };
  } catch {
    return null;
  }
};

export const swrSet = async (key, value) => {
  try {
    await AsyncStorage.setItem(
      PREFIX + key,
      JSON.stringify({ value, savedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
};
