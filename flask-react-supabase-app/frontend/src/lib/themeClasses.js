// Shared Tailwind class strings wrapping the --ex-* CSS custom properties
// from ExplorePage.css. Use these instead of inline var(--ex-*) to keep
// token references auditable from one place.
//
// Light values are the default on :root; .dark (toggled on <html> by
// ThemeContext) overrides them. Components that consume these classes
// must import './ExplorePage.css' (or a stylesheet that defines the
// --ex-* tokens) somewhere in the bundle.
export const surfaceBg = 'bg-[color:var(--ex-surface)]';
export const surfaceHigh = 'bg-[color:var(--ex-surface-high)]';
export const surfaceLow = 'bg-[color:var(--ex-surface-low)]';
export const surfaceDark = 'bg-[color:var(--ex-surface-dark)]';
export const pageBg = 'bg-[color:var(--ex-page-bg)]';
export const line = 'border-[color:var(--ex-line)]';
export const lineStrong = 'border-[color:var(--ex-line-strong)]';
export const textPrimary = 'text-[color:var(--ex-text)]';
export const textMuted = 'text-[color:var(--ex-text-muted)]';
export const brandBg = 'bg-[color:var(--ex-brand-subtle-bg)]';
export const primaryText = 'text-[color:var(--ex-primary)]';
export const primaryBg = 'bg-[color:var(--ex-primary)]';
export const accentText = 'text-[color:var(--ex-accent-green)]';
export const accentBg = 'bg-[color:var(--ex-accent-green)]';
export const inputBg = 'bg-[color:var(--ex-input-bg)]';
