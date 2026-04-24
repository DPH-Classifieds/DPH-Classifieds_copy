import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminOps.css';

const AdminDealers = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const filter = (searchParams.get('filter') || 'all').toLowerCase();

  const loadDealers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/admin/dealers');
      setDealers(Array.isArray(response) ? response : []);
    } catch (loadError) {
      console.error('Failed to fetch dealers:', loadError);
      setError('Failed to load dealer requests.');
      setDealers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDealers();
  }, []);

  const filteredDealers = useMemo(() => {
    if (filter === 'pending') {
      return dealers.filter((dealer) => !dealer.dealer_verified);
    }
    if (filter === 'verified') {
      return dealers.filter((dealer) => Boolean(dealer.dealer_verified));
    }
    return dealers;
  }, [dealers, filter]);

  const dealerSummary = useMemo(() => {
    const verified = dealers.filter((dealer) => Boolean(dealer.dealer_verified)).length;
    const pending = dealers.filter((dealer) => !dealer.dealer_verified).length;
    const withCompany = dealers.filter((dealer) => Boolean(dealer.company_name)).length;
    return {
      total: dealers.length,
      verified,
      pending,
      withCompany,
    };
  }, [dealers]);

  const updateDealerStatus = async (dealerId, approved) => {
    setActionLoadingId(dealerId);
    setError('');
    const endpoint = approved
      ? `/api/admin/dealers/${dealerId}/verify`
      : `/api/admin/dealers/${dealerId}/reject`;

    try {
      await apiClient.post(endpoint, approved ? {} : { reason: 'Rejected by admin' });
      await loadDealers();
    } catch (actionError) {
      console.error('Failed to update dealer status:', actionError);
      setError(actionError.message || 'Failed to update dealer status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const setFilter = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', next);
    }
    setSearchParams(params);
  };

  if (loading) {
    return <LoadingSpinner message="Loading dealer requests..." size="large" />;
  }

  return (
    <section className="admin-ops admin-page admin-dealers">
      <header className="admin-page-header">
        <div>
          <div className="admin-label">Dealers</div>
          <h1 className="admin-page-title">Dealer verification and performance</h1>
          <p className="admin-page-subtitle">Review company profiles, verification state, and move straight into a dealer detail page when you need deeper context.</p>
        </div>
        <div className="admin-actions">
          <span className="admin-status-pill tone-success">{dealerSummary.verified} verified</span>
          <span className="admin-status-pill tone-warning">{dealerSummary.pending} pending</span>
          <span className="admin-status-pill">{dealerSummary.withCompany} with company info</span>
        </div>
      </header>

      <div className="admin-kpi-grid" style={{ marginBottom: '18px' }}>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total dealers</div>
          <div className="admin-kpi-value">{dealerSummary.total}</div>
          <div className="admin-kpi-note">All dealer-flagged accounts.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Verified dealers</div>
          <div className="admin-kpi-value">{dealerSummary.verified}</div>
          <div className="admin-kpi-note">Approved and active dealer profiles.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Pending review</div>
          <div className="admin-kpi-value">{dealerSummary.pending}</div>
          <div className="admin-kpi-note">Need moderation or verification.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Company records</div>
          <div className="admin-kpi-value">{dealerSummary.withCompany}</div>
          <div className="admin-kpi-note">Profiles with company details on file.</div>
        </div>
      </div>

      <div className="admin-dealers__filters" role="tablist" aria-label="Dealer status filters">
        <button
          type="button"
          className={filter === 'all' ? 'active' : ''}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          type="button"
          className={filter === 'pending' ? 'active' : ''}
          onClick={() => setFilter('pending')}
        >
          Pending
        </button>
        <button
          type="button"
          className={filter === 'verified' ? 'active' : ''}
          onClick={() => setFilter('verified')}
        >
          Verified
        </button>
      </div>

      {error && <div className="admin-dealers__error">{error}</div>}

      <div className="admin-dealers__table-wrap">
        <table className="admin-dealers__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Company</th>
              <th>Phone</th>
              <th>Location</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDealers.length === 0 ? (
              <tr>
                <td colSpan="7" className="admin-dealers__empty">
                  No dealers found for this filter.
                </td>
              </tr>
            ) : (
              filteredDealers.map((dealer) => {
                const name = `${dealer.first_name || ''} ${dealer.last_name || ''}`.trim() || 'N/A';
                const status = dealer.dealer_verified ? 'Verified' : 'Pending';
                const loadingForRow = actionLoadingId === dealer.id;

                return (
                  <tr key={dealer.id}>
                    <td>{name}</td>
                    <td>{dealer.email || 'N/A'}</td>
                    <td>{dealer.company_name || 'N/A'}</td>
                    <td>{dealer.phone || 'N/A'}</td>
                    <td>{[dealer.city, dealer.emirate].filter(Boolean).join(', ') || 'N/A'}</td>
                    <td>
                      <span className={`admin-dealers__status ${dealer.dealer_verified ? 'verified' : 'pending'}`}>
                        {status}
                      </span>
                    </td>
                    <td>
                      <div className="admin-dealers__actions">
                        <button
                          type="button"
                          disabled={loadingForRow}
                          onClick={() => navigate(`/admin/dealers/${dealer.id}`)}
                          className="view"
                        >
                          View Details
                        </button>
                        {!dealer.dealer_verified && (
                          <>
                            <button
                              type="button"
                              disabled={loadingForRow}
                              onClick={() => updateDealerStatus(dealer.id, true)}
                              className="approve"
                            >
                              {loadingForRow ? 'Updating...' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={loadingForRow}
                              onClick={() => updateDealerStatus(dealer.id, false)}
                              className="reject"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default AdminDealers;
