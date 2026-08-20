import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../utils/apiClient';
import AdminDealers from '../AdminDealers';
import AdminDealerUpgradeRequests from './AdminDealerUpgradeRequests';

/**
 * AdminDealershipsHub — the single admin entry point for dealer management.
 *
 * "Dealer" and "Dealership" used to be two separate admin concepts/tabs
 * (dealer = the KYC person; dealership = the public-facing multi-staff org)
 * but admins only ever think of them as one thing, so this is now just
 * Dealers (pending/approved/all) plus limit requests. Featured listings has
 * its own top-level nav entry and isn't duplicated here.
 */
const TABS = [
  { key: 'dealers', label: 'Dealers' },
  { key: 'limits',  label: 'Limit requests' },
];

export default function AdminDealershipsHub() {
  const [activeTab, setActiveTab] = useState('dealers');
  const [counts, setCounts] = useState({ pendingLimits: null });

  const refreshCounts = useCallback(async () => {
    try {
      const limits = await apiClient.get('/api/admin/dealer/listing-upgrade-requests?status=pending');
      setCounts({ pendingLimits: Array.isArray(limits) ? limits.length : null });
    } catch {
      // Non-fatal: leave the count as null
    }
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  return (
    <div className="space-y-5 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Dealers</h1>
        <p className="text-sm text-white/50 mt-1">
          One place for every dealer-facing setting: KYC and listing limits.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={
              `px-4 py-2 -mb-px text-sm font-medium border-b-2 transition ` +
              (activeTab === t.key
                ? 'border-emerald-400 text-white'
                : 'border-transparent text-white/60 hover:text-white')
            }
          >
            {t.label}
            {t.key === 'limits' && counts.pendingLimits != null && counts.pendingLimits > 0 && (
              <span className="ml-2 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {counts.pendingLimits}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'dealers' && <AdminDealers />}
      {activeTab === 'limits' && <AdminDealerUpgradeRequests onResolved={refreshCounts} />}
    </div>
  );
}
