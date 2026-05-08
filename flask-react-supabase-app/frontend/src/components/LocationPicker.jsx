import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown } from 'lucide-react';
import './LocationPicker.css';

const UAE_CITIES = [
  { value: '', label: 'All UAE' },
  { value: 'Dubai', label: 'Dubai' },
  { value: 'Abu Dhabi', label: 'Abu Dhabi' },
  { value: 'Sharjah', label: 'Sharjah' },
  { value: 'Ajman', label: 'Ajman' },
  { value: 'Ras Al Khaimah', label: 'Ras Al Khaimah' },
  { value: 'Fujairah', label: 'Fujairah' },
  { value: 'Umm Al Quwain', label: 'Umm Al Quwain' },
];

const STORAGE_KEY = 'dph_selected_city';

const LocationPicker = ({ value, onChange, className = '' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const selected = UAE_CITIES.find((c) => c.value === (value || '')) || UAE_CITIES[0];

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (city) => {
    onChange(city.value);
    localStorage.setItem(STORAGE_KEY, city.value);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`lp-root ${className}`}>
      <button type="button" className="lp-trigger" onClick={() => setOpen(!open)}>
        <MapPin className="lp-icon" size={15} />
        <span className="lp-label">{selected.label}</span>
        <ChevronDown className={`lp-chevron ${open ? 'lp-chevron-open' : ''}`} size={14} />
      </button>
      {open && (
        <div className="lp-dropdown">
          {UAE_CITIES.map((city) => (
            <button
              key={city.value}
              type="button"
              className={`lp-option ${city.value === selected.value ? 'lp-option-active' : ''}`}
              onClick={() => handleSelect(city)}>
              {city.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const getSavedCity = () => localStorage.getItem(STORAGE_KEY) || '';
export default LocationPicker;
