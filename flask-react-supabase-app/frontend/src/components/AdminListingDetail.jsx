import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { formatCurrencyAED, formatDateTime, formatNumber, getDisplayName, getEventActorLabel, getListingTitle, getListingTypeLabel, getStatusTone } from './admin/adminUtils';
import '../styles/AdminOps.css';

const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

const listingRouteType = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'cars' || normalized === 'car') return 'car';
  if (normalized === 'bikes' || normalized === 'bike') return 'bike';
  if (normalized === 'parts' || normalized === 'part' || normalized === 'car-parts') return 'part';
  if (normalized === 'plates' || normalized === 'plate') return 'plate';
  return 'car';
};

const listingExtrasFromRecord = (listing) => {
  if (Array.isArray(listing?.extras) && listing.extras.length > 0) {
    return listing.extras;
  }

  const extraMap = {
    keyless_entry: 'Keyless Entry',
    dvd_player: 'DVD Player',
    climate_control: 'Climate Control',
    navigation_system: 'Navigation System',
    premium_sound_system: 'Premium Sound System',
    cooled_seats: 'Cooled Seats',
    front_wheel_drive: 'Front Wheel Drive',
    leather_seats: 'Leather Seats',
    parking_sensors: 'Parking Sensors',
    rear_view_camera: 'Rear View Camera',
    lady_driven: 'Lady Driven',
    doctor_driven: 'Doctor Driven',
    expat_owned: 'Expat Owned',
    executive_driven: 'Executive Driven',
  };

  return Object.entries(extraMap)
    .filter(([key]) => Boolean(listing?.[key]))
    .map(([, label]) => label);
};

const formatFieldValue = (value, format) => {
  if (format === 'currency') {
    return formatCurrencyAED(value);
  }

  if (format === 'date') {
    return formatDateTime(value);
  }

  if (format === 'number') {
    return formatNumber(value);
  }

  if (format === 'chips') {
    if (!Array.isArray(value) || value.length === 0) {
      return 'None';
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : 'None';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (value === null || value === undefined || value === '') {
    return 'Not set';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return String(value);
};

const buildField = (label, value, format) => ({
  label,
  value,
  format,
});

const AdminListingDetail = () => {
  const { itemType, itemId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [moderationNote, setModerationNote] = useState('');
  const [removeReason, setRemoveReason] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
        setData(response || null);
      } catch (fetchError) {
        console.error('Failed to load listing overview:', fetchError);
        setError(fetchError.message || 'Failed to load listing overview');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [itemId, itemType]);

  const listing = data?.listing ?? EMPTY_OBJECT;
  const owner = data?.owner ?? EMPTY_OBJECT;
  const summary = data?.summary || {};
  const images = data?.images ?? EMPTY_ARRAY;
  const leadEvents = data?.lead_events ?? EMPTY_ARRAY;
  const reports = data?.reports ?? EMPTY_ARRAY;
  const deletionEvents = data?.deletion_events ?? EMPTY_ARRAY;

  const primaryRouteType = listingRouteType(itemType);
  const approvalRouteType = primaryRouteType === 'part' ? 'parts' : `${primaryRouteType}s`;
  const listingTypeLabel = getListingTypeLabel(itemType);
  const statusTone = getStatusTone(listing?.status || 'pending');

  const handleModerationAction = async (action) => {
    try {
      setActionLoading(true);
      const endpoint = action === 'delete'
        ? `/api/${primaryRouteType}/${itemId}/delete`
        : `/api/${approvalRouteType}/${itemId}/${action}`;
      const payload =
        action === 'reject'
          ? { rejection_note: moderationNote }
          : action === 'delete'
            ? { reason: removeReason || moderationNote || 'Removed by admin' }
            : {};
      await apiClient.request(endpoint, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      const response = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
      setData(response || null);
    } catch (saveError) {
      setError(saveError.message || `Failed to ${action} listing`);
    } finally {
      setActionLoading(false);
    }
  };

  const leadTotals = useMemo(() => {
    return leadEvents.reduce(
      (acc, event) => {
        acc[event.action] = (acc[event.action] || 0) + 1;
        return acc;
      },
      { call_click: 0, whatsapp_click: 0, vin_open: 0, vin_reveal: 0 }
    );
  }, [leadEvents]);

  const detailSections = useMemo(() => {
    const titleValue = getListingTitle(listing);
    const priceValue = listing.display_price ?? listing.price ?? listing.expected_selling_price;
    const extras = listingExtrasFromRecord(listing);

    const identitySection = {
      title: 'Core Listing',
      fields: [
        buildField('Title', titleValue),
        buildField('Status', listing.status || 'pending'),
        buildField('Listing type', listingTypeLabel),
        buildField('Listing ID', listing.id),
        buildField('Type key', listing.type || primaryRouteType),
        buildField('Created at', listing.created_at, 'date'),
        buildField('Updated at', listing.updated_at, 'date'),
        buildField('Price', priceValue, 'currency'),
      ],
    };

    const ownerSection = {
      title: 'Owner & Contact',
      fields: [
        buildField('Owner name', getDisplayName(owner)),
        buildField('Owner email', owner.email || listing.user_email),
        buildField('Owner phone', owner.phone || owner.whatsapp_number || listing.car_owner_phone_number),
        buildField('Seller name', listing.seller_name),
        buildField('Seller email', listing.seller_email),
        buildField('Contact preference', listing.contact_preference),
      ],
    };

    const locationSection = {
      title: 'Location & Media',
      fields: [
        buildField('City', listing.city || listing.car_city || listing.location || listing.emirate),
        buildField('Emirate', listing.emirate),
        buildField('Area', listing.area),
        buildField('Car location', listing.car_location),
        buildField('Latitude', listing.latitude),
        buildField('Longitude', listing.longitude),
        buildField('Image count', images.length, 'number'),
        buildField('Listing URL', listing.tour_url),
      ],
    };

    if (primaryRouteType === 'bike') {
      return [
        identitySection,
        {
          title: 'Bike Specifications',
          fields: [
            buildField('Make year', listing.make_year, 'number'),
            buildField('Make', listing.make || listing.bike_brand),
            buildField('Model', listing.model || listing.bike_model),
            buildField('Bike type', listing.bike_type || listing.type || listing.bike_category),
            buildField('Engine size', listing.engine_size || listing.engine_capacity),
            buildField('Mileage', listing.mileage || listing.kilometer_driven, 'number'),
            buildField('Fuel type', listing.fuel_type),
            buildField('Transmission', listing.transmission_type),
            buildField('Ownership', listing.ownership_status),
            buildField('Extras', listingExtrasFromRecord(listing), 'chips'),
            buildField('Description', listing.description || listing.car_description),
          ],
        },
        ownerSection,
        locationSection,
        {
          title: 'Lifecycle & Moderation',
          fields: [
            buildField('Approved', listing.is_approved),
            buildField('Expires at', listing.expires_at, 'date'),
            buildField('Expired at', listing.expired_at, 'date'),
            buildField('Retention expires at', listing.retention_expires_at, 'date'),
            buildField('Archived', listing.is_archived),
            buildField('Rejection note', listing.rejection_note),
          ],
        },
      ];
    }

    if (primaryRouteType === 'plate') {
      return [
        identitySection,
        {
          title: 'Plate Details',
          fields: [
            buildField('City', listing.city),
            buildField('Code', listing.code),
            buildField('Number', listing.number),
            buildField('Digits', listing.digits, 'number'),
            buildField('Format', listing.plate_format),
            buildField('Plate type', listing.plate_type),
            buildField('Reserved', listing.is_reserved),
            buildField('Description', listing.description),
          ],
        },
        ownerSection,
        locationSection,
        {
          title: 'Lifecycle & Moderation',
          fields: [
            buildField('Approved', listing.is_approved),
            buildField('Expires at', listing.expires_at, 'date'),
            buildField('Expired at', listing.expired_at, 'date'),
            buildField('Retention expires at', listing.retention_expires_at, 'date'),
            buildField('Archived', listing.is_archived),
            buildField('Rejection note', listing.rejection_note),
          ],
        },
      ];
    }

    if (primaryRouteType === 'part') {
      return [
        identitySection,
        {
          title: 'Part Details',
          fields: [
            buildField('Part name', listing.name || listing.part_name),
            buildField('Brand', listing.brand),
            buildField('Category', listing.category || listing.part_type),
            buildField('Compatibility', listing.compatible_makes || listing.compatible_models),
            buildField('Condition', listing.condition),
            buildField('Price', listing.price, 'currency'),
            buildField('Description', listing.description),
          ],
        },
        ownerSection,
        locationSection,
        {
          title: 'Lifecycle & Moderation',
          fields: [
            buildField('Approved', listing.is_approved),
            buildField('Expires at', listing.expires_at, 'date'),
            buildField('Expired at', listing.expired_at, 'date'),
            buildField('Retention expires at', listing.retention_expires_at, 'date'),
            buildField('Archived', listing.is_archived),
            buildField('Rejection note', listing.rejection_note),
          ],
        },
      ];
    }

    return [
      identitySection,
      {
        title: 'Car Identity',
        fields: [
          buildField('Make year', listing.make_year, 'number'),
          buildField('Manufacturer', listing.car_manufacturer || listing.make),
          buildField('Model', listing.car_model || listing.model),
          buildField('Trim', listing.trim || listing.car_variant),
          buildField('Body type', listing.body_type),
          buildField('Regional spec', listing.regional_spec),
          buildField('Vehicle type', listing.vehicle_type),
          buildField('Ownership status', listing.ownership_status),
          buildField('Dealer listing', listing.is_dealer),
          buildField('Featured listing', listing.featured_listing),
        ],
      },
      {
        title: 'Specs & Condition',
        fields: [
          buildField('Mileage', listing.kilometer_driven || listing.kilometer || listing.mileage, 'number'),
          buildField('Fuel type', listing.fuel_type),
          buildField('Transmission', listing.transmission_type),
          buildField('Steering side', listing.steering_side),
          buildField('Seating capacity', listing.seating_capacity),
          buildField('Horsepower', listing.horsepower),
          buildField('Engine capacity', listing.engine_capacity),
          buildField('Cylinders', listing.cylinders),
          buildField('Doors', listing.doors),
          buildField('Color', listing.color),
          buildField('Interior color', listing.interior_color),
          buildField('Drivetrain', listing.drivetrain),
          buildField('Fuel efficiency', listing.fuel_efficiency),
          buildField('Top speed', listing.top_speed),
          buildField('0-100', listing.zero_to_hundred),
          buildField('Torque', listing.torque),
          buildField('Insured', listing.is_insured),
          buildField('Warranty', listing.warranty),
          buildField('Service history', listing.service_history),
          buildField('Lady driven', listing.lady_driven),
        ],
      },
      ownerSection,
      locationSection,
      {
        title: 'Description & Extras',
        fields: [
          buildField('Listing title', listing.listing_title),
          buildField('Car description', listing.car_description),
          buildField('VIN', listing.vin_number || listing.vin),
          buildField('WhatsApp number', listing.whatsapp_number),
          buildField('Country code', listing.country_code),
          buildField('WhatsApp country code', listing.whatsapp_country_code),
          buildField('WhatsApp pre-text', listing.whatsapp_prefill_text),
          buildField('Extras', extras, 'chips'),
        ],
      },
      {
        title: 'Lifecycle & Moderation',
        fields: [
          buildField('Approved', listing.is_approved),
          buildField('Expires at', listing.expires_at, 'date'),
          buildField('Expired at', listing.expired_at, 'date'),
          buildField('Retention expires at', listing.retention_expires_at, 'date'),
          buildField('Last extended at', listing.last_extended_at, 'date'),
          buildField('Extension count', listing.extension_count, 'number'),
          buildField('Archived', listing.is_archived),
          buildField('Rejection note', listing.rejection_note),
        ],
      },
    ];
  }, [images.length, listing, listingTypeLabel, owner, primaryRouteType]);

  if (loading) {
    return (
      <div className="admin-ops admin-page">
        <LoadingSpinner message="Loading listing intelligence..." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="admin-ops admin-page">
        <div className="admin-card">
          <h2>Listing not available</h2>
          <p className="admin-muted">{error}</p>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate('/admin/listings')}>
              Back to listings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-ops admin-page">
      <div className="admin-page-header">
        <div>
          <Link to="/admin/listings" className="admin-back-link">Back to listings</Link>
          <h1 className="admin-page-title">{getListingTitle(listing)}</h1>
          <p className="admin-page-subtitle">
            Drilldown for {listingTypeLabel.toLowerCase()} performance, moderation history, owner context, and lead activity.
          </p>
        </div>
        <div className="admin-actions">
          <span className={`admin-status-pill tone-${statusTone}`}>{listing.status || 'pending'}</span>
          <span className="admin-status-pill">{listingTypeLabel}</span>
          <span className="admin-status-pill">{formatNumber(summary.view_count)} views</span>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Qualified Leads</div>
          <div className="admin-kpi-value">{formatNumber(summary.qualified_leads)}</div>
          <div className="admin-kpi-note">Call and WhatsApp interactions.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Call Clicks</div>
          <div className="admin-kpi-value">{formatNumber(summary.call_clicks || leadTotals.call_click)}</div>
          <div className="admin-kpi-note">Phone intent on this listing.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">WhatsApp Clicks</div>
          <div className="admin-kpi-value">{formatNumber(summary.whatsapp_clicks || leadTotals.whatsapp_click)}</div>
          <div className="admin-kpi-note">Messaging intent on this listing.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Reports</div>
          <div className="admin-kpi-value">{formatNumber(summary.report_count)}</div>
          <div className="admin-kpi-note">Reports and moderation actions.</div>
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-surface">
          <div className="admin-hero-row">
            <div>
              <div className="admin-label">Listing</div>
              <h2 style={{ margin: '8px 0' }}>{getListingTitle(listing)}</h2>
              <div className="admin-muted">{formatCurrencyAED(listing.display_price ?? listing.price ?? listing.expected_selling_price)}</div>
              <div className="admin-muted">{listing.city || listing.car_city || listing.location || 'UAE'}</div>
            </div>
            <div className="admin-actions">
              <span className="admin-chip">Owner: {getDisplayName(owner)}</span>
              <span className="admin-chip">Created: {formatDateTime(listing.created_at)}</span>
              <span className="admin-chip">Updated: {formatDateTime(listing.updated_at)}</span>
            </div>
          </div>

          <div className="admin-divider" />

          <div className="admin-grid-2">
            <div className="admin-card">
              <div className="admin-label">Listing data</div>
              <p className="admin-muted">Status: {listing.status || 'pending'}</p>
              <p className="admin-muted">Type: {listingTypeLabel}</p>
              <p className="admin-muted">Owner email: {owner.email || listing.user_email || 'Not set'}</p>
              <p className="admin-muted">Owner phone: {owner.phone || owner.whatsapp_number || 'Not set'}</p>
              <p className="admin-muted">VIN: {listing.vin_number || listing.vin || 'Not set'}</p>
              <p className="admin-muted">Mileage: {listing.kilometer_driven || listing.kilometer || listing.mileage ? formatNumber(listing.kilometer_driven || listing.kilometer || listing.mileage) : 'N/A'} km</p>
              <p className="admin-muted">Rejection note: {listing.rejection_note || 'None'}</p>
            </div>
            <div className="admin-card">
              <div className="admin-label">Media</div>
              <p className="admin-muted">Image count: {formatNumber(images.length)}</p>
              <p className="admin-muted">Lead events: {formatNumber(leadEvents.length)}</p>
              <p className="admin-muted">Reports: {formatNumber(reports.length)}</p>
              <p className="admin-muted">Deletion events: {formatNumber(deletionEvents.length)}</p>
              <div className="admin-actions" style={{ marginTop: '12px' }}>
                <button className="admin-button admin-button-primary" type="button" onClick={() => navigate(`/admin/users/${listing.user_id}`)}>
                  Open owner profile
                </button>
                <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate(`/admin/${primaryRouteType}s`)}>
                  Back to {primaryRouteType}s
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-surface">
          <div className="admin-label">Moderation</div>
          <h3>Approve, reject, or remove</h3>
          <div className="admin-field">
            <label htmlFor="moderation-note">Note</label>
            <textarea
              id="moderation-note"
              className="admin-textarea"
              value={moderationNote}
              onChange={(event) => setModerationNote(event.target.value)}
              placeholder="Add an internal note or rejection reason..."
            />
          </div>
          <div className="admin-field" style={{ marginTop: '12px' }}>
            <label htmlFor="delete-reason">Removal reason</label>
            <input
              id="delete-reason"
              className="admin-input"
              value={removeReason}
              onChange={(event) => setRemoveReason(event.target.value)}
              placeholder="Reason for deletion"
            />
          </div>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            {listing.status !== 'approved' ? (
              <button className="admin-button admin-button-primary" type="button" disabled={actionLoading} onClick={() => handleModerationAction('approve')}>
                Approve
              </button>
            ) : null}
            <button className="admin-button" type="button" disabled={actionLoading} onClick={() => handleModerationAction('reject')}>
              Reject
            </button>
            <button
              className="admin-button admin-button-secondary"
              type="button"
              disabled={actionLoading}
              onClick={async () => {
                try {
                  setActionLoading(true);
                  await apiClient.post(`/api/admin/listings/${itemType}/${itemId}/vin-unlock`, {});
                  const response = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
                  setData(response || null);
                } catch (unlockError) {
                  setError(unlockError.message || 'Failed to unlock VIN');
                } finally {
                  setActionLoading(false);
                }
              }}
            >
              VIN Unlock
            </button>
            <button className="admin-button admin-button-danger" type="button" disabled={actionLoading} onClick={() => handleModerationAction('delete')}>
              Remove listing
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section">
        <h2>Full listing schema</h2>
        <div className="admin-grid-2">
          {detailSections.map((section) => (
            <div key={section.title} className="admin-card">
              <div className="admin-label">{section.title}</div>
              <div className="admin-detail-list">
                {section.fields.map((field) => {
                  const renderedValue = formatFieldValue(field.value, field.format);
                  return (
                    <div key={field.label} className="admin-detail-row">
                      <div className="admin-detail-label">{field.label}</div>
                      <div className="admin-detail-value">
                        {field.format === 'chips' && Array.isArray(renderedValue) ? (
                          renderedValue.length > 0 ? (
                            <div className="admin-chip-list">
                              {renderedValue.map((chip) => (
                                <span key={chip} className="admin-chip">{chip}</span>
                              ))}
                            </div>
                          ) : (
                            'None'
                          )
                        ) : (
                          renderedValue
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h2>Images</h2>
        <div className="admin-three-up">
          {images.length === 0 ? (
            <div className="admin-card">No images available.</div>
          ) : images.map((image) => (
            <div key={image.id || image.image_url} className="admin-card">
              <img
                src={image.display_url || image.image_url || image.url}
                alt={getListingTitle(listing)}
                style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: '16px' }}
              />
              <p className="admin-muted" style={{ marginTop: '10px' }}>
                Primary: {image.is_primary ? 'Yes' : 'No'} · Uploaded: {formatDateTime(image.uploaded_at)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Actor</th>
                <th>Lead event</th>
                <th>Action</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {leadEvents.length === 0 ? (
                <tr><td colSpan="4" className="admin-muted">No lead events found.</td></tr>
              ) : leadEvents.slice(0, 15).map((event) => (
                <tr key={event.id}>
                  <td>{getEventActorLabel(event)}</td>
                  <td>{event.listing_type} · {event.listing_id}</td>
                  <td>{event.action}</td>
                  <td>{formatDateTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Reports</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr><td colSpan="3" className="admin-muted">No reports found.</td></tr>
              ) : reports.slice(0, 15).map((report) => (
                <tr key={report.id}>
                  <td>{report.listing_type} · {report.listing_id}</td>
                  <td>{report.reason || 'N/A'}</td>
                  <td>{report.status || 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-section">
        <h2>Deletion history</h2>
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Deleted by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {deletionEvents.length === 0 ? (
                <tr><td colSpan="3" className="admin-muted">No deletion history found.</td></tr>
              ) : deletionEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.reason}</td>
                  <td>{event.deleted_by_role}</td>
                  <td>{formatDateTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminListingDetail;
