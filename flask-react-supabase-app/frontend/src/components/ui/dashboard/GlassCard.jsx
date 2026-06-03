import React from 'react';

export const GlassCard = ({ className = '', children, ...rest }) => (
  <div
    className={`bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5 ${className}`}
    {...rest}
  >
    {children}
  </div>
);

export default GlassCard;
