import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import '../styles/AdminLayout.css';

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
    <div className="admin-layout">
      <AdminHeader
        onToggleSidebar={() => setSidebarOpen((current) => !current)}
        sidebarOpen={sidebarOpen}
      />
      <div className="admin-content-wrapper">
        {isMobile && sidebarOpen && (
          <button
            type="button"
            className="admin-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close admin navigation"
          />
        )}
        <AdminSidebar open={sidebarOpen} user={user} onLogout={handleLogout} />
        <main className={`admin-main ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
