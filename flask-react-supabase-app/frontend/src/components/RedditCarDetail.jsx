import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { resolveMediaUrl } from '../utils/media';
import SeoMeta from './SeoMeta';
import RedditSourcePanel from './RedditSourcePanel';
import SavedListingToggleButton from './SavedListingToggleButton';
import { buildListingSeo } from '../utils/seo';
import './CarDetailRedesigned.css';
import './RedditCarDetail.css';

const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const formatPrice = (price) => {
  if (!price) return 'Price on request';
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(price);
};

const resolveImages = (car) => {
  const raw = Array.isArray(car?.images)
    ? car.images
    : Array.isArray(car?.car_images)
      ? car.car_images
      : [];
  const urls = raw.length
    ? raw.map((img) => (typeof img === 'string' ? img : img?.display_url || img?.image_url || img?.url))
    : [car?.display_url, car?.image_url, car?.url];
  return urls.map(resolveMediaUrl).filter(Boolean);
};

// Minimal, clean detail view for cars imported from r/DubaiPetrolHeads. Reddit
// imports carry only make/model/year/price/one image + the source post, so the
// full CarDetail (loan calculator, VIN, spec grids, contact seller, map) would
// render mostly empty. This showcases only the data we actually have.
export default function RedditCarDetail({ car }) {
  const { id } = useParams();
  const [active, setActive] = useState(0);
  const images = useMemo(() => resolveImages(car), [car]);

  const title =
    [car?.make_year, car?.car_manufacturer, car?.car_model].filter(Boolean).join(' ').trim() ||
    car?.listing_title ||
    'Reddit listing';
  const city = car?.car_city && car.car_city !== 'Unspecified' ? car.car_city : null;
  const mileage = Number(car?.kilometer_driven);

  const seoData = useMemo(
    () => buildListingSeo('car', car || {}, { canonicalPath: `/cars/${id}`, location: city || 'UAE' }),
    [car, id, city]
  );

  const specs = [
    car?.make_year ? { label: 'Year', value: car.make_year } : null,
    Number.isFinite(mileage) && mileage > 0 ? { label: 'Mileage', value: `${mileage.toLocaleString()} km` } : null,
    city ? { label: 'Location', value: city } : null,
  ].filter(Boolean);

  return (
    <div className="rcd-container">
      <SeoMeta {...seoData} />
      <div className="rcd-max-width">
        <nav className="rcd-breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/explore?category=reddit">Reddit</Link>
          <span>/</span>
          <span className="rcd-breadcrumb-current">{car?.car_model || 'Listing'}</span>
        </nav>

        <article className="rcd-card">
          <div className="rcd-media">
            {images[active] ? (
              <img
                src={images[active]}
                alt={title}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = PLACEHOLDER_IMAGE;
                }}
              />
            ) : (
              <div className="rcd-media-placeholder">
                <span>DPH Classifieds</span>
              </div>
            )}
          </div>

          {images.length > 1 && (
            <div className="rcd-thumbs">
              {images.map((src, i) => (
                <button
                  key={`${src}-${i}`}
                  type="button"
                  className={`rcd-thumb ${i === active ? 'is-active' : ''}`}
                  onClick={() => setActive(i)}
                  aria-label={`Photo ${i + 1}`}
                >
                  <img src={src} alt={`${title} ${i + 1}`} loading="lazy" />
                </button>
              ))}
            </div>
          )}

          <div className="rcd-body">
            <span className="rcd-source-tag">Reddit · r/DubaiPetrolHeads</span>
            <h1 className="rcd-title">{title}</h1>
            <p className="rcd-price">{formatPrice(car?.expected_selling_price)}</p>

            {specs.length > 0 && (
              <dl className="rcd-specs">
                {specs.map((s) => (
                  <div key={s.label} className="rcd-spec">
                    <dt>{s.label}</dt>
                    <dd>{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="rcd-actions">
              <RedditSourcePanel car={car} />
              <SavedListingToggleButton
                listingType="car"
                listingId={id}
                listingData={car}
                className="saved-listing-button-detail"
                label="Save listing"
                showLabel
              />
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
