import React from 'react';
import { Outlet } from 'react-router-dom';
import DealerSidebar from './DealerSidebar';
import ActingAsBanner from './ActingAsBanner';
import '../styles/AdminLayout.css';

const DealerLayout = () => (
  <div className="admin-layout">
    <ActingAsBanner />
    <div className="admin-layout-inner">
      <DealerSidebar />
      <main className="admin-main"><Outlet /></main>
    </div>
  </div>
);

export default DealerLayout;
