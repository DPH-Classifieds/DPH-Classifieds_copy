// flask-react-supabase-app/frontend/src/components/dealer/DealerLeadStatusPill.jsx
import React from 'react';

const TONES = {
  new:          'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  contacted:    'bg-sky-500/10 border-sky-500/30 text-sky-300',
  quoted:       'bg-violet-500/10 border-violet-500/30 text-violet-300',
  test_drive:   'bg-amber-500/10 border-amber-500/30 text-amber-300',
  won:          'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
  lost:         'bg-rose-500/10 border-rose-500/30 text-rose-300',
};

const LABELS = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  test_drive: 'Test drive',
  won: 'Won',
  lost: 'Lost',
};

export default function DealerLeadStatusPill({ status }) {
  const tone = TONES[status] || 'bg-white/[0.04] border-white/[0.08] text-white/60';
  const label = LABELS[status] || status || 'Unknown';
  return (
    <span className={`inline-flex items-center text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ${tone}`}>
      {label}
    </span>
  );
}
