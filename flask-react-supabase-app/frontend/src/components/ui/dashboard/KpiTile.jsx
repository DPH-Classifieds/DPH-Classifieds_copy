import React, { useEffect, useState } from 'react';
import { animate, useMotionValue } from 'motion/react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { GlassCard } from './GlassCard';

const useAnimatedNumber = (target) => {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(mv, target, { duration: 0.6, ease: 'easeOut' });
    const unsub = mv.on('change', (v) => setDisplay(Math.round(v)));
    return () => {
      controls.stop();
      unsub();
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  return display;
};

const AnimatedValue = ({ value, prefix = '', suffix = '', accent }) => {
  const animated = useAnimatedNumber(typeof value === 'number' ? value : 0);
  const display =
    typeof value === 'number'
      ? animated.toLocaleString('en-AE')
      : value;

  return (
    <p
      className={`text-3xl font-semibold tabular-nums ${
        accent === 'emerald' ? 'text-emerald-300' : 'text-white'
      }`}
    >
      {prefix}
      {display}
      {suffix}
    </p>
  );
};

const DeltaPill = ({ delta }) => {
  if (delta == null) return null;
  const positive = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 border ${
        positive
          ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
          : 'text-rose-300 bg-rose-500/10 border-rose-500/20'
      }`}
    >
      {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {positive ? '+' : ''}
      {delta.toFixed(1)}%
    </span>
  );
};

export const KpiTile = ({
  label,
  value,
  delta,
  icon: Icon,
  suffix,
  prefix,
  accent = 'default',
  loading = false,
  onClick,
}) => {
  const isClickable = typeof onClick === 'function';

  return (
    <GlassCard
      className={`relative overflow-hidden ${
        isClickable
          ? 'cursor-pointer hover:ring-2 hover:ring-white/10 transition-all duration-150'
          : ''
      }`}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      {/* Icon top-right */}
      {Icon && (
        <div className="absolute top-4 right-4">
          <Icon size={16} className="text-white/30" />
        </div>
      )}

      {/* Label */}
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">
        {label}
      </p>

      {/* Value */}
      {loading ? (
        <div className="animate-pulse bg-white/[0.06] rounded-lg h-9 w-24 mb-2" />
      ) : (
        <AnimatedValue
          value={value}
          prefix={prefix}
          suffix={suffix}
          accent={accent}
        />
      )}

      {/* Delta */}
      <div className="mt-2 h-5">
        {!loading && <DeltaPill delta={delta} />}
      </div>
    </GlassCard>
  );
};

export default KpiTile;
