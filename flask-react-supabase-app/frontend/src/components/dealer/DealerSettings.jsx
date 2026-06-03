// flask-react-supabase-app/frontend/src/components/dealer/DealerSettings.jsx
import React, { useState } from 'react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

const fields = ['name', 'legal_name', 'phone', 'whatsapp', 'website', 'bio'];

const DealerSettings = () => {
  const { dealership, refresh } = useDealer();
  const [form, setForm] = useState(() => Object.fromEntries(fields.map(f => [f, dealership?.[f] || ''])));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await apiClient.request('/api/dealer/profile', { method: 'PATCH', body: form });
    setSaving(false);
    refresh();
  };
  return (
    <div>
      <h1>Settings</h1>
      {fields.map(f => (
        <div key={f} style={{ marginBottom: 8 }}>
          <label>{f}<br />
            <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} style={{ width: 400 }} />
          </label>
        </div>
      ))}
      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
};

export default DealerSettings;
