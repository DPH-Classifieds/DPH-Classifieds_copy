import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';
import AdminDealerships from './AdminDealerships';
import AdminDealerUpgradeRequests from './AdminDealerUpgradeRequests';
import AdminFeaturedListings from './AdminFeaturedListings';

/**
 * AdminDealershipsHub — the single admin entry point for everything dealer-related.
 *
 * The codebase has two related concepts:
 *   - "Dealer"  = a public.users row flagged is_dealer=true who passed KYC
 *   - "Dealership" = a dealerships table row (storefront / brand / org)
 *
 * They were created for different reasons (dealer = the KYC person;
 * dealership = the public-facing org with multi-staff access) but admins
 * want to manage them together. This page is the unified view: three tabs
 * (Dealerships, Limit requests, Featured) so all settings live behind
 * one route at /admin/dealerships/hub (and the original sub-routes still
 * work for deep links).
 */
const TABS = [
  { key: 'dealerships', label: 'Dealerships' },
  { key: 'limits',      label: 'Limit requests' },
  { key: 'featured',    label: 'Featured' },
];

export default function AdminDealershipsHub() {
  const [activeTab, setActiveTab] = useState('dealerships');
  const [counts, setCounts] = useState({ pendingLimits: null, activeFeatured: null });

  const refreshCounts = useCallback(async () => {
    try {
      const [limitsResp, featuredResp] = await Promise.allSettled([
        apiClient.get('/api/admin/dealer/listing-upgrade-requests?status=pending'),
        apiClient.get('/api/admin/featured-listings'),
      ]);
      setCounts({
        pendingLimits: limitsResp.status === 'fulfilled' && Array.isArray(limitsResp.value)
          ? limitsResp.value.length : null,
        activeFeatured: featuredResp.status === 'fulfilled' && Array.isArray(featuredResp.value)
          ? featuredResp.value.length : null,
      });
    } catch {
      // Non-fatal: leave the counts as null
    }
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  return (
    <div className="space-y-5 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Dealerships</h1>
        <p className="text-sm text-white/50 mt-1">
          One place for every dealer-facing setting: KYC, members, listing limits, and featured placements.
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
            {t.key === 'featured' && counts.activeFeatured != null && counts.activeFeatured > 0 && (
              <span className="ml-2 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {counts.activeFeatured}
              </span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 text-xs text-white/40">
          <Link to="/admin/dealers" className="hover:text-white">Legacy Dealers list →</Link>
        </div>
      </div>

      {activeTab === 'dealerships' && <AdminDealerships />}
      {activeTab === 'limits' && <AdminDealerUpgradeRequests onResolved={refreshCounts} />}
      {activeTab === 'featured' && <AdminFeaturedListings />}
    </div>
  );
}
