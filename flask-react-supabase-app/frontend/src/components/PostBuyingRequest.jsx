import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect } from '../utils/directUpload';
import { getAccessToken } from '../utils/supabaseClient';
import { carMakes, carModels, carTrims } from '../utils/carData';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const ITEM_TYPES = [
  { value: 'car', label: 'Car' },
  { value: 'plate', label: 'Plate' },
  { value: 'part', label: 'Car Part' },
  { value: 'bike', label: 'Bike' },
];

const REGIONAL_SPEC_OPTIONS = ['GCC', 'American', 'European', 'Japanese', 'Canadian', 'Korean', 'Chinese', 'Other'];

const inputClass =
  'rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white focus:border-[#8bd6b4] focus:outline-none disabled:opacity-50';

export default function PostBuyingRequest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedPreview, setSelectedPreview] = useState('');
  const [form, setForm] = useState({
    item_type: 'car',
    item_name: '',
    reference_notes: '',
    mileage_preference: '',
    regional_spec: '',
    budget: '',
    car_manufacturer: '',
    car_model: '',
    trim: '',
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
    images: [],
  });

  const showCarFields = useMemo(() => form.item_type === 'car', [form.item_type]);

  const availableModels = useMemo(
    () => (form.car_manufacturer ? carModels[form.car_manufacturer] || [] : []),
    [form.car_manufacturer]
  );

  const availableTrims = useMemo(() => {
    if (!form.car_manufacturer || !form.car_model) return [];
    return (carTrims[form.car_manufacturer] && carTrims[form.car_manufacturer][form.car_model]) || [];
  }, [form.car_manufacturer, form.car_model]);

  // Clear dependent selections when their parent changes.
  useEffect(() => {
    setForm((prev) => {
      if (!prev.car_manufacturer && (prev.car_model || prev.trim)) {
        return { ...prev, car_model: '', trim: '' };
      }
      if (prev.car_model && availableModels.length && !availableModels.includes(prev.car_model)) {
        return { ...prev, car_model: '', trim: '' };
      }
      return prev;
    });
  }, [form.car_manufacturer, availableModels]);

  useEffect(() => {
    setForm((prev) => {
      if (prev.trim && availableTrims.length && !availableTrims.includes(prev.trim)) {
        return { ...prev, trim: '' };
      }
      return prev;
    });
  }, [availableTrims]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onPhoneNumberChange = (e) => {
    // Digits only, drop spaces/dashes/leading zeros so we can prefix the country code cleanly.
    const digitsOnly = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
    setForm((prev) => ({ ...prev, whatsapp_number: digitsOnly }));
  };

  const onAddReferenceImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > LISTING_IMAGE_MAX_BYTES) {
      setError('Reference image is too large.');
      return;
    }
    setSelectedPreview((currentPreview) => {
      if (currentPreview) {
        URL.revokeObjectURL(currentPreview);
      }
      return URL.createObjectURL(file);
    });
    setSelectedFiles([file]);
    setForm((prev) => ({ ...prev, images: [] }));
  };

  useEffect(
    () => () => {
      if (selectedPreview) {
        URL.revokeObjectURL(selectedPreview);
      }
    },
    [selectedPreview]
  );

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (!user?.id) {
        setError('You must be logged in to post a buying request.');
        return;
      }

      if (!form.whatsapp_number || form.whatsapp_number.length < 6) {
        setError('Please enter a valid WhatsApp number.');
        return;
      }

      let images = form.images;
      if ((!images || images.length === 0) && selectedFiles.length > 0) {
        setUploading(true);
        images = await uploadListingImagesDirect(selectedFiles, { userId: user.id });
        setForm((prev) => ({ ...prev, images }));
      }

      const token = await getAccessToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        ...form,
        images,
        budget: form.budget ? Number(form.budget) : null,
      };
      const resp = await axios.post(`${API_URL}/api/buying-requests`, payload, { headers });
      navigate(`/buying-requests/${resp.data.id}`);
    } catch (err) {
      const apiError = err?.response?.data?.error || 'Failed to post buying request.';
      setError(apiError);
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 pb-16 pt-10">
      <h1 className="text-2xl font-semibold text-white">Post a Buying Request</h1>
      <p className="mt-1 text-sm text-white/60">Your username stays anonymous to other users.</p>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-100">{error}</div>
      ) : null}

      <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-5">
        <label className="grid gap-1 text-sm text-white/80">
          Item Type*
          <select name="item_type" value={form.item_type} onChange={onChange} className={inputClass}>
            {ITEM_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm text-white/80">
          Item Name*
          <input
            name="item_name"
            value={form.item_name}
            onChange={onChange}
            className={inputClass}
            placeholder="e.g. Toyota Land Cruiser 2020+"
            required
          />
        </label>

        {showCarFields ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm text-white/80">
              Make
              <select
                name="car_manufacturer"
                value={form.car_manufacturer}
                onChange={onChange}
                className={inputClass}
              >
                <option value="">Select Make</option>
                {carMakes.map((make) => (
                  <option key={make} value={make}>
                    {make}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-white/80">
              Model
              <select
                name="car_model"
                value={form.car_model}
                onChange={onChange}
                disabled={!form.car_manufacturer}
                className={inputClass}
              >
                <option value="">{form.car_manufacturer ? 'Select Model' : 'Pick a make first'}</option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-white/80">
              Trim
              {availableTrims.length > 0 ? (
                <select name="trim" value={form.trim} onChange={onChange} className={inputClass}>
                  <option value="">Select Trim</option>
                  {availableTrims.map((trim) => (
                    <option key={trim} value={trim}>
                      {trim}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name="trim"
                  value={form.trim}
                  onChange={onChange}
                  className={inputClass}
                  placeholder={form.car_model ? 'Enter trim' : 'Pick a model first'}
                  disabled={!form.car_model}
                />
              )}
            </label>
          </div>
        ) : null}

        <label className="grid gap-1 text-sm text-white/80">
          Description / Features
          <textarea
            name="reference_notes"
            value={form.reference_notes}
            onChange={onChange}
            rows={4}
            className={inputClass}
            placeholder="Describe the exact spec you want."
          />
        </label>

        <label className="grid gap-1 text-sm text-white/80">
          Mileage preference*
          <input
            name="mileage_preference"
            value={form.mileage_preference}
            onChange={onChange}
            className={inputClass}
            placeholder="e.g. under 80,000 km"
            required
          />
        </label>

        <label className="grid gap-1 text-sm text-white/80">
          Regional spec*
          <select
            name="regional_spec"
            value={form.regional_spec}
            onChange={onChange}
            className={inputClass}
            required
          >
            <option value="">Select Regional Spec</option>
            {REGIONAL_SPEC_OPTIONS.map((spec) => (
              <option key={spec} value={spec}>
                {spec}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-sm text-white/80">
          Budget (AED)
          <input
            name="budget"
            value={form.budget}
            onChange={onChange}
            inputMode="numeric"
            className={inputClass}
            placeholder="Optional"
          />
        </label>

        <div className="grid gap-1 text-sm text-white/80">
          <span>Phone / WhatsApp Number*</span>
          <div className="flex gap-2">
            <select
              name="whatsapp_country_code"
              value={form.whatsapp_country_code}
              onChange={onChange}
              className={`${inputClass} w-32 shrink-0`}
              aria-label="Country code"
            >
              {countryCodes.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.code}
                </option>
              ))}
            </select>
            <input
              type="tel"
              name="whatsapp_number"
              value={form.whatsapp_number}
              onChange={onPhoneNumberChange}
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="Phone number"
              className={`${inputClass} flex-1`}
              required
            />
          </div>
          <span className="text-xs text-white/50">
            Buyers will reach you on this number for calls and WhatsApp. Only revealed to phone-verified users.
          </span>
        </div>

        <label className="grid gap-1 text-sm text-white/80">
          Reference image*
          <input type="file" accept="image/*" onChange={onAddReferenceImage} className="text-white/80" />
          <span className="text-xs text-white/50">Max {Math.round(LISTING_IMAGE_MAX_BYTES / 1024 / 1024)}MB.</span>
        </label>

        {selectedPreview ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
            <div className="px-3 py-2 text-xs uppercase tracking-wide text-white/50">Image preview</div>
            <img src={selectedPreview} alt="Reference preview" className="h-56 w-full object-cover" />
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || uploading}
          className="mt-2 rounded-xl bg-[#8bd6b4] px-4 py-3 font-semibold text-black disabled:opacity-60"
        >
          {uploading ? 'Uploading image…' : submitting ? 'Posting…' : 'Post Buying Request'}
        </button>
      </form>
    </div>
  );
}
