import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';

const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth > 1024;
  });
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 1024;
  });
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1024px)');

    const updateLayoutState = () => {
      const nextIsMobile = mediaQuery.matches;
      setIsMobile(nextIsMobile);
      setSidebarOpen(!nextIsMobile);
    };

    updateLayoutState();
    mediaQuery.addEventListener('change', updateLayoutState);

    return () => {
      mediaQuery.removeEventListener('change', updateLayoutState);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Admin logout failed:', error);
    } finally {
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--ex-shell-bg)] text-white">
      <AdminHeader
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        sidebarOpen={sidebarOpen}
      />
      <div className="flex relative">
        {/* Mobile backdrop */}
        {isMobile && sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close admin navigation"
          />
        )}

        <AdminSidebar open={sidebarOpen} user={user} onLogout={handleLogout} isMobile={isMobile} />

        <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8 max-w-[1800px] mx-auto w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
