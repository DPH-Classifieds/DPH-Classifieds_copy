export const readFilterState = (searchParams, defaults, aliases = {}) => {
  const next = { ...defaults };

  Object.keys(defaults).forEach((key) => {
    const value = searchParams.get(aliases[key] || key);
    if (value === null) return;
    if (typeof defaults[key] === 'boolean') {
      next[key] = value === 'true' || value === '1';
    } else if (Array.isArray(defaults[key])) {
      next[key] = value ? value.split(',').filter(Boolean) : [];
    } else {
      next[key] = value;
    }
  });

  return next;
};

export const writeFilterState = (searchParams, filters, defaults, aliases = {}) => {
  const next = new URLSearchParams(searchParams);

  Object.keys(defaults).forEach((key) => {
    const param = aliases[key] || key;
    const value = filters[key];
    const isDefault = Array.isArray(value)
      ? value.length === 0 && defaults[key].length === 0
      : value === defaults[key];

    next.delete(param);
    if (value === '' || value === null || value === undefined || isDefault) return;
    if (Array.isArray(value)) {
      if (value.length) next.set(param, value.join(','));
    } else {
      next.set(param, String(value));
    }
  });

  return next;
};
