const PREFIX = 'dph_swr:';

export const swrGet = (key) => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw);
    return { value, ageMs: Date.now() - savedAt };
  } catch {
    return null;
  }
};

export const swrSet = (key, value) => {
  try {
    window.localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ value, savedAt: Date.now() }),
    );
  } catch {
    /* quota — give up */
  }
};
