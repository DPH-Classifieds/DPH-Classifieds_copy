import React from 'react';
import { Outlet } from 'react-router-dom';
import DealerSidebar from './DealerSidebar';
import ActingAsBanner from './ActingAsBanner';
import { useDealer } from '../context/DealerContext';

const DealerLayout = () => {
  const { loading } = useDealer();

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#070d10' }}>
      <ActingAsBanner />
      <div className="flex flex-1">
        {/* Sidebar — hidden on small screens, icon-only on md, full on lg+ */}
        <div className="hidden lg:flex flex-shrink-0">
          <DealerSidebar />
        </div>
        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="px-8 py-10 max-w-[1600px] mx-auto">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="animate-pulse bg-white/[0.04] rounded-2xl h-32"
                  />
                ))}
              </div>
            ) : (
              <Outlet />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DealerLayout;
