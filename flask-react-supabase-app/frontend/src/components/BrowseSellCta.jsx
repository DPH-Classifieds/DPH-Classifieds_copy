import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';

import { useAuth } from '../context/AuthContext';

import './BrowseSellCta.css';

const COPY_BY_CATEGORY = {
  plates: {
    kicker: 'Sell plates',
    title: 'List your plate in the same premium DPH flow.',
    body:
      'Post in minutes, keep the listing polished, and reach buyers already looking for UAE number plates.',
    postHref: '/post-plate',
    postLabel: 'Post Your License Plate',
  },
  cars: {
    kicker: 'Sell cars',
    title: 'List your car in the same premium DPH flow.',
    body:
      'Post in minutes, keep the listing polished, and reach buyers already browsing UAE cars on DPH.',
    postHref: '/post-car',
    postLabel: 'Post Your Car',
  },
  bikes: {
    kicker: 'Sell bikes',
    title: 'List your bike in the same premium DPH flow.',
    body:
      'Post in minutes, keep the listing polished, and reach buyers already browsing motorcycles on DPH.',
    postHref: '/post-bike',
    postLabel: 'Post Your Bike',
  },
  parts: {
    kicker: 'Sell parts',
    title: 'List your part in the same premium DPH flow.',
    body:
      'Post in minutes, keep the listing polished, and reach buyers already browsing UAE car parts on DPH.',
    postHref: '/post-car-parts',
    postLabel: 'Post Your Car Part',
  },
  'buying-requests': {
    kicker: 'Want to buy',
    title: "Can't find it? Post what you're looking for.",
    body:
      'Tell sellers exactly what you want — make, model, budget — and let them come to you. Posters stay anonymous until you choose to reveal contact.',
    postHref: '/post-buying-request',
    postLabel: 'Post a WTB Request',
  },
};

export default function BrowseSellCta({ category = 'cars', overrideCopy }) {
  const { user } = useAuth();
  const copy = overrideCopy ?? COPY_BY_CATEGORY[category] ?? COPY_BY_CATEGORY.cars;

  const primaryHref = user ? copy.postHref : '/login';
  const primaryLabel = user ? copy.postLabel : 'Log In to Post';

  return (
    <div className="dphsell-cta">
      <div className="dphsell-cta-content">
        <div className="dphsell-cta-copy">
          <span className="dphsell-cta-kicker">
            <Sparkles size={14} aria-hidden="true" />
            {copy.kicker}
          </span>
          <h2>{copy.title}</h2>
          <p>{copy.body}</p>
          <div className="dphsell-cta-tags" aria-label="CTA highlights">
            <span className="dphsell-cta-tag">
              <Sparkles size={14} aria-hidden="true" />
              Free to list
            </span>
            <span className="dphsell-cta-tag">
              <ShieldCheck size={14} aria-hidden="true" />
              Login required to post
            </span>
          </div>
        </div>
        <div className="dphsell-cta-actions">
          <Link to={primaryHref} className="dphsell-cta-button">
            {primaryLabel}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          {!user ? (
            <Link to="/signup" className="dphsell-cta-secondary">
              Create an account
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
