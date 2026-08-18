import React from 'react';

/**
 * FeaturedBadge — the small, high-contrast pill that shows on a listing card
 * or row when the listing is currently featured by an admin.
 *
 * Designed to stand out on both light and dark backgrounds. Uses amber/gold
 * (warm, attention-grabbing) with a subtle star icon.
 */
export default function FeaturedBadge({ size = 'sm', className = '' }) {
  const sizing = size === 'lg'
    ? 'text-sm px-3 py-1 gap-1.5'
    : 'text-[10px] px-2 py-0.5 gap-1';
  return (
    <span
      className={
        `inline-flex items-center font-bold uppercase tracking-wider rounded-full ` +
        `bg-gradient-to-r from-amber-300 via-amber-400 to-yellow-400 ` +
        `text-amber-950 border border-amber-500/40 shadow-sm shadow-amber-500/20 ` +
        sizing + ' ' + className
      }
      title="Featured by DPH admins"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className={size === 'lg' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'}
        aria-hidden="true"
      >
        <path d="M12 2l2.39 7.36H22l-6.18 4.49L18.21 22 12 17.27 5.79 22l2.39-8.15L2 9.36h7.61z" />
      </svg>
      Featured
    </span>
  );
}
