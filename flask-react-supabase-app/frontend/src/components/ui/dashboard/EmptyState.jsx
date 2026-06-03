import React from 'react';

export const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
    {Icon && <Icon size={48} className="text-white/20" />}
    {title && <p className="text-white text-base font-medium">{title}</p>}
    {description && <p className="text-white/50 text-sm max-w-xs">{description}</p>}
    {action && <div className="mt-1">{action}</div>}
  </div>
);

export default EmptyState;
