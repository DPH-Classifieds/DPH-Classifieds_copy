import React, { useEffect, useState } from 'react';
import { Eye, Loader2, X } from 'lucide-react';
import apiClient from '../../utils/apiClient';

export default function VinRevealAnalyticsModal({ open, onClose, listings = [], days }) {
  const [selected, setSelected] = useState(null);
  const [actors, setActors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!open) { setSelected(null); setActors([]); setSummary(null); } }, [open]);
  if (!open) return null;
  const inspect = async (listing) => {
    setSelected(listing); setLoading(true); setActors([]); setSummary(null);
    try {
      const data = await apiClient.get(`/api/admin/contact-analytics/vin-listings/${listing.listing_type}/${listing.listing_id}?days=${days}`);
      setActors(data?.actors || []);
      setSummary(data?.listing || null);
    } finally { setLoading(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-3xl max-h-[85vh] overflow-auto rounded-2xl border border-white/10 bg-[#11131a] p-6 shadow-2xl">
      <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">VIN reveal activity</h2><p className="text-sm text-white/50">Select a listing to view the buyers who revealed its VIN.</p></div><button onClick={onClose} className="rounded-lg p-2 text-white/60 hover:bg-white/10"><X size={18}/></button></div>
      {!selected && <div className="space-y-2">{listings.length === 0 ? <p className="py-8 text-center text-sm text-white/50">No VIN reveals in this period.</p> : listings.map((listing) => <button key={`${listing.listing_type}:${listing.listing_id}`} onClick={() => inspect(listing)} className="flex w-full items-center justify-between rounded-xl border border-white/10 p-4 text-left hover:bg-white/[.06]"><span><span className="mr-2 uppercase text-xs text-white/40">{listing.listing_type}</span><span className="font-medium text-white">{listing.listing_id}</span></span><span className="inline-flex items-center gap-2 text-sm text-amber-300"><Eye size={15}/>{listing.raw_vin_reveals} reveals · {listing.unique_vin_revealers} buyers</span></button>)}</div>}
      {selected && <div><button onClick={() => setSelected(null)} className="mb-4 text-sm text-amber-300 hover:text-amber-200">← All VIN-reveal listings</button><div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">{summary?.image_url ? <img src={summary.image_url} alt="" className="h-14 w-20 flex-none rounded-lg object-cover"/> : <div className="flex h-14 w-20 flex-none items-center justify-center rounded-lg bg-white/5 text-white/30"><Eye size={16}/></div>}<div className="min-w-0"><p className="truncate font-medium text-white">{summary?.title || selected.listing_id}</p><p className="text-xs text-white/45"><span className="uppercase">{selected.listing_type}</span> · {selected.listing_id}</p>{summary?.public_url && <a href={summary.public_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-300 hover:text-amber-200">View listing →</a>}</div></div>{loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-white/60"/></div> : <div className="space-y-2">{actors.length === 0 ? <p className="py-8 text-center text-sm text-white/50">No identified VIN revealers in this period.</p> : actors.map((actor, index) => <div key={`${actor.actor_name}:${index}`} className="flex items-center justify-between rounded-xl border border-white/10 p-4"><div><p className="font-medium text-white">{actor.actor_name}</p><p className="text-xs text-white/45">Last reveal: {new Date(actor.last_revealed_at).toLocaleString()}</p></div><span className="text-sm text-amber-300">{actor.reveal_count} reveal{actor.reveal_count === 1 ? '' : 's'}</span></div>)}</div>}</div>}
    </div>
  </div>;
}
