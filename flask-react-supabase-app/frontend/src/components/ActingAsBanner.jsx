import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useDealer } from '../context/DealerContext';

const ActingAsBanner = () => {
  const { dealership, actorKind } = useDealer();
  const navigate = useNavigate();

  if (actorKind !== 'admin' || !dealership) return null;

  return (
    <div className="sticky top-0 z-50 h-11 flex items-center justify-between px-5 bg-gradient-to-r from-orange-600 to-rose-600 text-[color:var(--ex-shell-on-accent)] text-sm font-medium">
      <span className="flex items-center gap-2">
        <ShieldAlert size={15} className="opacity-90" />
        Acting as <b className="font-bold ml-1">{dealership.name}</b>.
        <span className="opacity-80 ml-0.5">Writes are audited.</span>
      </span>
      <button
        onClick={() => navigate('/admin/dealerships/hub')}
        className="text-xs font-semibold bg-[rgba(255,255,255,0.20)] hover:bg-[rgba(255,255,255,0.30)] border border-[rgba(255,255,255,0.30)] rounded-full px-3 py-1 transition-colors"
      >
        Exit
      </button>
    </div>
  );
};

export default ActingAsBanner;
