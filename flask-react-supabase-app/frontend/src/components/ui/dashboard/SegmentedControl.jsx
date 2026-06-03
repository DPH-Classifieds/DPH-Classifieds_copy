import React from 'react';

export const SegmentedControl = ({ options = [], value, onChange }) => (
  <div className="flex bg-white/[0.04] border border-white/[0.06] rounded-full p-1">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        onClick={() => onChange && onChange(opt.value)}
        className={`rounded-full px-3 py-1 text-xs transition-colors ${
          value === opt.value
            ? 'bg-white/10 text-white'
            : 'text-white/50 hover:text-white'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export default SegmentedControl;
