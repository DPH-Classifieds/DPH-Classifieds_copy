export const formatPrice = (price) => {
  if (price === null || price === undefined) return 'AED 0';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return 'AED 0';
  return `AED ${num.toLocaleString('en-US')}`;
};

export const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatNumber = (num) => {
  if (num === null || num === undefined) return '0';
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US');
};

const AED_TO_USD_RATE = 0.2723;

export const formatPriceUSD = (price) => {
  if (price === null || price === undefined) return '';
  const num = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(num)) return '';
  const usd = num * AED_TO_USD_RATE;
  return `~$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

export const timeAgo = (date) => {
  if (!date) return '';
  const now = new Date();
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const seconds = Math.floor((now - d) / 1000);

  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(days / 365);
  return `${years}y ago`;
};
