// flask-react-supabase-app/frontend/src/components/dealer/DealerDashboard.jsx
import React, { useState } from 'react';
import { useDealer } from '../../context/DealerContext';
import DealerKpiTiles from './DealerKpiTiles';
import DealerTrends from './DealerTrends';
import DealerFunnel from './DealerFunnel';
import DealerPerformers from './DealerPerformers';

const DealerDashboard = () => {
  const { dealership } = useDealer();
  const [window, setWindow] = useState(30);
  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>{dealership?.name}</h1>
        <select value={window} onChange={(e) => setWindow(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </header>
      <DealerKpiTiles window={window} />
      <div style={{ height: 16 }} />
      <DealerTrends window={window} />
      <div style={{ height: 16 }} />
      <DealerFunnel window={window} />
      <div style={{ height: 16 }} />
      <DealerPerformers window={window} />
    </div>
  );
};

export default DealerDashboard;
