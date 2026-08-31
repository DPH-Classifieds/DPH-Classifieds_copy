const getRedditRowKey = (row) => {
  if (!row || row.id === undefined || row.id === null) return null;
  return `${row._redditType || row.listing_type || 'listing'}:${row.id}`;
};

const compareRedditRows = (left, right) => {
  const rightDate = Date.parse(right?.created_at || right?.source_created_at || '') || 0;
  const leftDate = Date.parse(left?.created_at || left?.source_created_at || '') || 0;
  if (rightDate !== leftDate) return rightDate - leftDate;
  return String(getRedditRowKey(left) || '').localeCompare(String(getRedditRowKey(right) || ''));
};

export const mergeRedditRows = (chunks) => {
  const unique = new Map();
  chunks.flat().forEach((row) => {
    const key = getRedditRowKey(row);
    if (key && !unique.has(key)) unique.set(key, row);
  });
  return [...unique.values()].sort(compareRedditRows);
};

export const paginateRedditRows = (chunks, offset, pageSize) => {
  const rows = mergeRedditRows(chunks);
  const start = Math.max(0, offset || 0);
  const size = Math.max(1, pageSize || 1);
  return {
    items: rows.slice(start, start + size),
    hasMore: rows.length > start + size,
  };
};
