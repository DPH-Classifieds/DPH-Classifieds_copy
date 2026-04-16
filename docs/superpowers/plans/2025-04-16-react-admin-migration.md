# React Admin Panel Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Flask server-side rendered admin panel to React frontend with modern UI/UX, full feature parity, and eliminate 404 errors on admin routes.

**Architecture:** Single-page React admin application using existing Supabase authentication, with AdminRoute middleware for access control, AdminLayout for navigation, and modular admin components for different features.

**Tech Stack:** React 18, React Router, Supabase Auth, Flask (backend API), Tailwind CSS

---

## File Structure

### New Files (Create)
- `frontend/src/components/AdminLayout.js` - Main admin layout wrapper with sidebar and header
- `frontend/src/components/AdminSidebar.js` - Navigation sidebar with menu items
- `frontend/src/components/AdminHeader.js` - Header with user menu and logout
- `frontend/src/styles/AdminLayout.css` - Modern admin styling

### Modified Files (Update)
- `frontend/src/components/AdminRoute.jsx` - Improve admin auth checking
- `frontend/src/App.js` - Add admin routes with AdminRoute protection
- `frontend/src/components/Navbar.js` - Add admin panel link to user dropdown
- `frontend/src/components/AdminDashboard.js` - Complete all tabs and functionality
- `frontend/src/components/AdminUsers.js` - Complete user management
- `frontend/src/components/AdminTools.js` - Complete admin tools
- `backend/app.py` - Remove Flask admin template routes

---

### Task 1: Create AdminLayout Component

**Files:**
- Create: `frontend/src/components/AdminLayout.js`
- Test: (Component will be tested via integration tests)

- [ ] **Step 1: Write AdminLayout component structure**

```jsx
import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import AdminHeader from './AdminHeader';
import '../styles/AdminLayout.css';

const AdminLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="admin-layout">
      <AdminHeader
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        sidebarOpen={sidebarOpen}
      />
      <div className="admin-content-wrapper">
        <AdminSidebar open={sidebarOpen} />
        <main className={`admin-main ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
```

- [ ] **Step 2: Create AdminLayout CSS**

```css
/* frontend/src/styles/AdminLayout.css */
.admin-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #f8fafc;
}

.admin-content-wrapper {
  display: flex;
  flex: 1;
  margin-top: 60px;
}

.admin-main {
  flex: 1;
  padding: 24px;
  transition: margin-left 0.3s ease;
  overflow-x: hidden;
}

.admin-main.sidebar-open {
  margin-left: 250px;
}

.admin-main.sidebar-closed {
  margin-left: 60px;
}

@media (max-width: 768px) {
  .admin-main.sidebar-open,
  .admin-main.sidebar-closed {
    margin-left: 0;
  }
}
```

- [ ] **Step 3: Test AdminLayout renders without errors**

Run: `npm start` and navigate to admin route (will fail until other components exist)
Expected: Layout renders, sidebar and header containers exist

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AdminLayout.js frontend/src/styles/AdminLayout.css
git commit -m "feat: create AdminLayout component with sidebar and header"
```

---

### Task 2: Create AdminSidebar Component

**Files:**
- Create: `frontend/src/components/AdminSidebar.js`
- Modify: `frontend/src/styles/AdminLayout.css`

- [ ] **Step 1: Write AdminSidebar component**

```jsx
import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import '../styles/AdminLayout.css';

const AdminSidebar = ({ open }) => {
  const location = useLocation();

  const menuItems = [
    { path: '/admin', icon: '📊', label: 'Dashboard' },
    { path: '/admin/listings', icon: '📝', label: 'Listings' },
    { path: '/admin/dealers', icon: '🏪', label: 'Dealers' },
    { path: '/admin/users', icon: '👥', label: 'Users' },
    { path: '/admin/reports', icon: '📋', label: 'Reports' },
  ];

  return (
    <aside className={`admin-sidebar ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <h2>Admin Panel</h2>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'active' : ''}`
            }
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default AdminSidebar;
```

- [ ] **Step 2: Add sidebar CSS to AdminLayout.css**

```css
/* Add to frontend/src/styles/AdminLayout.css */
.admin-sidebar {
  position: fixed;
  top: 60px;
  left: 0;
  width: 250px;
  height: calc(100vh - 60px);
  background-color: #1e293b;
  color: white;
  transition: width 0.3s ease;
  z-index: 100;
}

.admin-sidebar.closed {
  width: 60px;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid #334155;
}

.sidebar-header h2 {
  font-size: 18px;
  margin: 0;
  font-weight: 600;
}

.admin-sidebar.closed .sidebar-header h2 {
  display: none;
}

.sidebar-nav {
  padding: 16px 0;
}

.sidebar-link {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  color: #94a3b8;
  text-decoration: none;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.sidebar-link:hover {
  background-color: #334155;
  color: white;
}

.sidebar-link.active {
  background-color: #2563eb;
  color: white;
  border-left-color: #60a5fa;
}

.sidebar-icon {
  font-size: 20px;
  min-width: 24px;
}

.sidebar-label {
  margin-left: 12px;
  white-space: nowrap;
}

.admin-sidebar.closed .sidebar-label {
  display: none;
}

@media (max-width: 768px) {
  .admin-sidebar {
    position: fixed;
    transform: translateX(-100%);
  }

  .admin-sidebar.open {
    transform: translateX(0);
  }
}
```

- [ ] **Step 3: Test sidebar renders and navigation works**

Run: `npm start` and check sidebar renders, links navigate correctly
Expected: Sidebar shows all menu items, links work, active state highlights

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AdminSidebar.js frontend/src/styles/AdminLayout.css
git commit -m "feat: create AdminSidebar with navigation menu"
```

---

### Task 3: Create AdminHeader Component

**Files:**
- Create: `frontend/src/components/AdminHeader.js`
- Modify: `frontend/src/styles/AdminLayout.css`

- [ ] **Step 1: Write AdminHeader component**

```jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/AdminLayout.css';

const AdminHeader = ({ onToggleSidebar, sidebarOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await apiClient.post('/api/auth/logout');
      logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      // Still clear local state even if API call fails
      logout();
      navigate('/login');
    }
  };

  return (
    <header className="admin-header">
      <div className="header-left">
        <button
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
        <h1 className="header-title">DPH Classifieds Admin</h1>
      </div>
      <div className="header-right">
        <div className="user-info">
          <span className="user-name">{user?.display_name || user?.email}</span>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
```

- [ ] **Step 2: Add header CSS to AdminLayout.css**

```css
/* Add to frontend/src/styles/AdminLayout.css */
.admin-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background-color: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  z-index: 1000;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sidebar-toggle {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 16px;
  color: #64748b;
  transition: all 0.2s ease;
}

.sidebar-toggle:hover {
  background-color: #f1f5f9;
  color: #1e293b;
}

.header-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.header-right {
  display: flex;
  align-items: center;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 16px;
}

.user-name {
  font-size: 14px;
  color: #64748b;
}

.logout-btn {
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.logout-btn:hover {
  background-color: #dc2626;
}

@media (max-width: 768px) {
  .header-title {
    font-size: 16px;
  }

  .user-name {
    display: none;
  }
}
```

- [ ] **Step 3: Test header renders and logout works**

Run: `npm start` and check header shows user info, logout button works
Expected: Header displays, user name shown, logout clears session

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/AdminHeader.js frontend/src/styles/AdminLayout.css
git commit -m "feat: create AdminHeader with logout functionality"
```

---

### Task 4: Update AdminRoute for Proper Auth Checking

**Files:**
- Modify: `frontend/src/components/AdminRoute.jsx`

- [ ] **Step 1: Update AdminRoute to handle loading and error states better**

```jsx
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminLayout.css';

const AdminRoute = ({ children }) => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiClient.get('/api/auth/admin-check');
        if (response && response.is_admin === true) {
          setIsAdmin(true);
        } else {
          setError('Access denied');
        }
      } catch (error) {
        console.error('Admin check failed:', error);
        setError('Failed to verify admin access');
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [user]);

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Verifying admin access...</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="admin-access-denied">
        <div className="access-denied-content">
          <h2>🚫 Access Denied</h2>
          <p>You do not have permission to access this page.</p>
          {error && <p className="error-message">{error}</p>}
          <button onClick={() => navigate('/')} className="back-btn">
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return children;
};

export default AdminRoute;
```

- [ ] **Step 2: Add AdminRoute CSS**

```css
/* Add to frontend/src/styles/AdminLayout.css */
.admin-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 16px;
}

.admin-loading p {
  color: #64748b;
  font-size: 16px;
}

.admin-access-denied {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  padding: 24px;
}

.access-denied-content {
  text-align: center;
  max-width: 400px;
}

.access-denied-content h2 {
  font-size: 28px;
  color: #1e293b;
  margin: 0 0 16px 0;
}

.access-denied-content p {
  font-size: 16px;
  color: #64748b;
  margin: 0 0 24px 0;
}

.error-message {
  color: #ef4444;
  font-weight: 500;
  margin-bottom: 24px !important;
}

.back-btn {
  background-color: #2563eb;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.back-btn:hover {
  background-color: #1d4ed8;
}
```

- [ ] **Step 3: Test AdminRoute blocks non-admin users**

Run: Login as non-admin user, try to access /admin route
Expected: Shows "Access Denied" message with back button

- [ ] **Step 4: Test AdminRoute allows admin users**

Run: Login as admin user, access /admin route
Expected: Renders children components

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminRoute.jsx frontend/src/styles/AdminLayout.css
git commit -m "feat: improve AdminRoute with better error handling and UI"
```

---

### Task 5: Add Admin Link to User Menu

**Files:**
- Modify: `frontend/src/components/Navbar.js`

- [ ] **Step 1: Find user dropdown menu in Navbar component**

Read: `frontend/src/components/Navbar.js`
Action: Identify where user dropdown menu is rendered

- [ ] **Step 2: Add admin panel link to user dropdown**

```jsx
// Add this inside the user dropdown menu in Navbar.js
// Add import at top if not present
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';

// Add state for admin status
const [isAdmin, setIsAdmin] = useState(false);
const { user } = useAuth();

// Add useEffect to check admin status when user changes
useEffect(() => {
  const checkAdmin = async () => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    try {
      const response = await apiClient.get('/api/auth/admin-check');
      setIsAdmin(response && response.is_admin === true);
    } catch (error) {
      setIsAdmin(false);
    }
  };

  checkAdmin();
}, [user]);

// Add admin link in user dropdown menu
{isAdmin && (
  <a href="/admin" className="dropdown-item">
    Admin Panel
  </a>
)}
```

- [ ] **Step 3: Test admin link appears only for admin users**

Run: Login as admin → link should appear in dropdown
Run: Login as regular user → link should not appear
Expected: Link shows/hides based on admin status

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Navbar.js
git commit -m "feat: add admin panel link to user dropdown menu"
```

---

### Task 6: Update App.js with Admin Routes

**Files:**
- Modify: `frontend/src/App.js`

- [ ] **Step 1: Read current App.js structure**

Read: `frontend/src/App.js`
Action: Understand existing route structure

- [ ] **Step 2: Update imports to include AdminLayout**

```jsx
// Add to imports in App.js
import AdminLayout from './components/AdminLayout';
```

- [ ] **Step 3: Update admin routes to use AdminLayout**

```jsx
// Replace existing admin routes with:
<Route
  path="/admin/*"
  element={
    <AdminRoute>
      <AdminLayout />
    </AdminRoute>
  }
>
  <Route path="" element={<AdminDashboard />} />
  <Route path="users" element={<AdminUsers />} />
  <Route path="listings" element={<AdminDashboard />} /> {/* Will handle in Task 8 */}
  <Route path="dealers" element={<AdminDashboard />} /> {/* Will handle in Task 9 */}
  <Route path="reports" element={<AdminDashboard />} /> {/* Will handle in Task 10 */}
</Route>
```

- [ ] **Step 4: Test admin routes work**

Run: `npm start`, navigate to /admin, /admin/users
Expected: Routes render correctly with AdminLayout wrapper

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.js
git commit -m "feat: update App.js with AdminLayout and admin routes"
```

---

### Task 7: Complete AdminDashboard with Modern UI

**Files:**
- Modify: `frontend/src/components/AdminDashboard.js`
- Modify: `frontend/src/styles/AdminDashboard.css`

- [ ] **Step 1: Read current AdminDashboard implementation**

Read: `frontend/src/components/AdminDashboard.js`
Action: Understand current implementation and tabs structure

- [ ] **Step 2: Update AdminDashboard with modern UI and complete functionality**

```jsx
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';

const AdminDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingCounts, setPendingCounts] = useState({
    cars: 0,
    parts: 0,
    plates: 0,
    dealers: 0,
    reports: 0
  });

  useEffect(() => {
    const fetchPendingCounts = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/admin/pending-counts');
        setPendingCounts(response || {
          cars: 0,
          parts: 0,
          plates: 0,
          dealers: 0,
          reports: 0
        });
      } catch (error) {
        console.error('Failed to fetch pending counts:', error);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchPendingCounts();
  }, []);

  const StatCard = ({ title, count, icon, path }) => (
    <div
      className="stat-card"
      onClick={() => navigate(path)}
      role="button"
      tabIndex={0}
    >
      <div className="stat-icon">{icon}</div>
      <div className="stat-content">
        <div className="stat-count">{count}</div>
        <div className="stat-title">{title}</div>
      </div>
    </div>
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <h1>Welcome, {user?.display_name || user?.email}!</h1>
        <p>Manage your platform from here</p>
      </div>

      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}

      <div className="stats-grid">
        <StatCard
          title="Pending Cars"
          count={pendingCounts.cars}
          icon="🚗"
          path="/admin/listings?filter=cars"
        />
        <StatCard
          title="Pending Parts"
          count={pendingCounts.parts}
          icon="⚙️"
          path="/admin/listings?filter=parts"
        />
        <StatCard
          title="Pending Plates"
          count={pendingCounts.plates}
          icon="🚙"
          path="/admin/listings?filter=plates"
        />
        <StatCard
          title="Pending Dealers"
          count={pendingCounts.dealers}
          icon="🏪"
          path="/admin/dealers?filter=pending"
        />
        <StatCard
          title="Reports"
          count={pendingCounts.reports}
          icon="📋"
          path="/admin/reports"
        />
      </div>

      <div className="dashboard-actions">
        <button
          onClick={() => navigate('/admin/users')}
          className="action-button primary"
        >
          Manage Users
        </button>
        <button
          onClick={() => navigate('/admin/listings')}
          className="action-button secondary"
        >
          Manage Listings
        </button>
      </div>
    </div>
  );
};

export default AdminDashboard;
```

- [ ] **Step 3: Create modern AdminDashboard CSS**

```css
/* frontend/src/styles/AdminDashboard.css */
.admin-dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.dashboard-header {
  margin-bottom: 32px;
}

.dashboard-header h1 {
  font-size: 32px;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.dashboard-header p {
  font-size: 16px;
  color: #64748b;
  margin: 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
}

.stat-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.stat-icon {
  font-size: 48px;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f1f5f9;
  border-radius: 50%;
}

.stat-content {
  flex: 1;
}

.stat-count {
  font-size: 36px;
  font-weight: 700;
  color: #1e293b;
  line-height: 1;
  margin-bottom: 4px;
}

.stat-title {
  font-size: 14px;
  color: #64748b;
  font-weight: 500;
}

.dashboard-actions {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.action-button {
  padding: 14px 28px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.action-button.primary {
  background-color: #2563eb;
  color: white;
}

.action-button.primary:hover {
  background-color: #1d4ed8;
}

.action-button.secondary {
  background-color: white;
  color: #1e293b;
  border: 2px solid #e2e8f0;
}

.action-button.secondary:hover {
  background-color: #f8fafc;
  border-color: #cbd5e1;
}

.success-message {
  background-color: #dcfce7;
  color: #166534;
  padding: 16px 24px;
  border-radius: 8px;
  margin-bottom: 24px;
  font-weight: 500;
}

.error-container {
  text-align: center;
  padding: 48px;
}

.error-container h2 {
  color: #1e293b;
  margin-bottom: 16px;
}

.error-container p {
  color: #64748b;
  margin-bottom: 24px;
}

.error-container button {
  background-color: #2563eb;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

@media (max-width: 768px) {
  .admin-dashboard {
    padding: 16px;
  }

  .dashboard-header h1 {
    font-size: 24px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .stat-card {
    padding: 20px;
  }

  .stat-icon {
    font-size: 36px;
    width: 48px;
    height: 48px;
  }

  .stat-count {
    font-size: 28px;
  }

  .dashboard-actions {
    flex-direction: column;
  }

  .action-button {
    width: 100%;
  }
}
```

- [ ] **Step 4: Test dashboard renders and stats load**

Run: Access /admin as admin user
Expected: Dashboard shows stats cards, clicking cards navigates to respective pages

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminDashboard.js frontend/src/styles/AdminDashboard.css
git commit -m "feat: implement modern AdminDashboard with stats and navigation"
```

---

### Task 8: Complete Listings Management in AdminDashboard

**Files:**
- Modify: `frontend/src/components/AdminDashboard.js`
- Create: `frontend/src/components/AdminListings.js`

- [ ] **Step 1: Create AdminListings component for approve/reject functionality**

```jsx
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';

const AdminListings = () => {
  const [searchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'cars';
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const fetchListings = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get(`/api/admin/approve/${filter}`);
        setListings(Array.isArray(response) ? response : []);
      } catch (error) {
        console.error('Failed to fetch listings:', error);
        setListings([]);
      } finally {
        setLoading(false);
      }
    };

    fetchListings();
  }, [filter]);

  const handleApprove = async (listingId) => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/approve/${filter}/${listingId}/approve`);
      setListings(listings.filter(l => l.id !== listingId));
      setSuccessMessage('Listing approved successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowDetailModal(false);
    } catch (error) {
      console.error('Failed to approve listing:', error);
      alert('Failed to approve listing. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/approve/${filter}/${selectedListing.id}/reject`, {
        rejection_note: rejectionNote
      });
      setListings(listings.filter(l => l.id !== selectedListing.id));
      setSuccessMessage('Listing rejected successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowRejectModal(false);
      setShowDetailModal(false);
      setRejectionNote('');
    } catch (error) {
      console.error('Failed to reject listing:', error);
      alert('Failed to reject listing. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const ListingCard = ({ listing }) => (
    <div className="listing-card">
      <div className="listing-info">
        <h3>{listing.title || `${listing.make} ${listing.model}`}</h3>
        <p>Price: {listing.price} AED</p>
        <p>Seller: {listing.seller_email || 'N/A'}</p>
        <p>Status: <span className="status-pending">Pending</span></p>
      </div>
      <div className="listing-actions">
        <button
          onClick={() => {
            setSelectedListing(listing);
            setShowDetailModal(true);
          }}
          className="action-button view-btn"
        >
          View Details
        </button>
        <button
          onClick={() => handleApprove(listing.id)}
          className="action-button approve-btn"
          disabled={actionLoading}
        >
          Approve
        </button>
      </div>
    </div>
  );

  if (loading) return <LoadingSpinner />;

  return (
    <div className="admin-listings">
      <div className="page-header">
        <h1>Pending {filter.charAt(0).toUpperCase() + filter.slice(1)}</h1>
        {successMessage && (
          <div className="success-message">{successMessage}</div>
        )}
      </div>

      {listings.length === 0 ? (
        <div className="empty-state">
          <h2>No pending {filter} to review</h2>
        </div>
      ) : (
        <div className="listings-grid">
          {listings.map(listing => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {showDetailModal && selectedListing && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Listing Details</h2>
              <button
                onClick={() => setShowDetailModal(false)}
                className="close-modal"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {/* Add detailed listing information here */}
              <p><strong>Title:</strong> {selectedListing.title || `${selectedListing.make} ${selectedListing.model}`}</p>
              <p><strong>Price:</strong> {selectedListing.price} AED</p>
              <p><strong>Description:</strong> {selectedListing.description || 'N/A'}</p>
              <p><strong>Seller:</strong> {selectedListing.seller_email || 'N/A'}</p>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowRejectModal(true)}
                className="action-button reject-btn"
                disabled={actionLoading}
              >
                Reject
              </button>
              <button
                onClick={() => handleApprove(selectedListing.id)}
                className="action-button approve-btn"
                disabled={actionLoading}
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Reject Listing</h2>
              <button
                onClick={() => setShowRejectModal(false)}
                className="close-modal"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <label>Rejection Note:</label>
              <textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Enter reason for rejection..."
                rows={4}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowRejectModal(false)}
                className="action-button secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="action-button reject-btn"
                disabled={actionLoading || !rejectionNote.trim()}
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminListings;
```

- [ ] **Step 2: Add listing management CSS to AdminDashboard.css**

```css
/* Add to frontend/src/styles/AdminDashboard.css */
.admin-listings {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  margin-bottom: 32px;
}

.page-header h1 {
  font-size: 28px;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 16px 0;
}

.listings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 24px;
}

.listing-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.listing-info h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.listing-info p {
  font-size: 14px;
  color: #64748b;
  margin: 4px 0;
}

.status-pending {
  color: #f59e0b;
  font-weight: 500;
}

.listing-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.action-button.view-btn {
  flex: 1;
  background-color: #64748b;
  color: white;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: none;
}

.action-button.view-btn:hover {
  background-color: #475569;
}

.action-button.approve-btn {
  flex: 1;
  background-color: #10b981;
  color: white;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: none;
}

.action-button.approve-btn:hover {
  background-color: #059669;
}

.action-button.approve-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-button.reject-btn {
  flex: 1;
  background-color: #ef4444;
  color: white;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: none;
}

.action-button.reject-btn:hover {
  background-color: #dc2626;
}

.action-button.reject-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: 64px 24px;
}

.empty-state h2 {
  font-size: 24px;
  color: #64748b;
  margin: 0;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

.modal-content {
  background: white;
  border-radius: 12px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.close-modal {
  background: none;
  border: none;
  font-size: 28px;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.close-modal:hover {
  color: #1e293b;
}

.modal-body {
  padding: 24px;
}

.modal-body p {
  font-size: 14px;
  color: #64748b;
  margin: 12px 0;
}

.modal-body label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #1e293b;
  margin-bottom: 8px;
}

.modal-body textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  color: #1e293b;
  resize: vertical;
}

.modal-body textarea:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 24px;
  border-top: 1px solid #e2e8f0;
}

@media (max-width: 768px) {
  .listings-grid {
    grid-template-columns: 1fr;
  }

  .listing-actions {
    flex-direction: column;
  }
}
```

- [ ] **Step 3: Update App.js to use AdminListings component**

```jsx
// Add to App.js imports
import AdminListings from './components/AdminListings';

// Update admin routes to use AdminListings
<Route
  path="/admin/listings"
  element={
    <AdminRoute>
      <AdminLayout />
    </AdminRoute>
  }
>
  <Route path="" element={<AdminListings />} />
</Route>
```

- [ ] **Step 4: Test listings approve/reject functionality**

Run: Access /admin/listings, approve and reject listings
Expected: Can view listings, approve removes from list, reject requires note

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminListings.js frontend/src/components/AdminDashboard.js frontend/src/styles/AdminDashboard.css frontend/src/App.js
git commit -m "feat: implement listings approve/reject functionality"
```

---

### Task 9: Complete Users Management

**Files:**
- Modify: `frontend/src/components/AdminUsers.js`
- Modify: `frontend/src/styles/AdminUsers.css`

- [ ] **Step 1: Read current AdminUsers implementation**

Read: `frontend/src/components/AdminUsers.js`
Action: Understand current implementation

- [ ] **Step 2: Update AdminUsers with complete functionality**

```jsx
import React, { useState, useEffect } from 'react';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminUsers.css';

const AdminUsers = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/admin/users');
        setUsers(Array.isArray(response) ? response : []);
      } catch (error) {
        console.error('Failed to fetch users:', error);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const filteredUsers = users.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.last_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleAdminStatus = async (userId, currentStatus) => {
    try {
      await apiClient.put(`/api/admin/users/${userId}/admin-status`, {
        is_admin: !currentStatus
      });
      setUsers(users.map(user =>
        user.id === userId
          ? { ...user, is_admin: !currentStatus }
          : user
      ));
      setSuccessMessage('User admin status updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Failed to update admin status:', error);
      alert('Failed to update admin status. Please try again.');
    }
  };

  const toggleBanUser = async (userId, currentStatus) => {
    try {
      await apiClient.put(`/api/admin/users/${userId}/account-status`, {
        account_status: currentStatus === 'active' ? 'suspended' : 'active'
      });
      setUsers(users.map(user =>
        user.id === userId
          ? { ...user, account_status: currentStatus === 'active' ? 'suspended' : 'active' }
          : user
      ));
      setSuccessMessage('User account status updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Failed to update account status:', error);
      alert('Failed to update account status. Please try again.');
    }
  };

  const UserCard = ({ user }) => (
    <div className="user-card">
      <div className="user-header">
        <div className="user-avatar">
          {user.profile_photo_url ? (
            <img src={user.profile_photo_url} alt={user.display_name} />
          ) : (
            <div className="avatar-placeholder">
              {user.first_name?.charAt(0) || user.email?.charAt(0)}
            </div>
          )}
        </div>
        <div className="user-info">
          <h3>{user.display_name || `${user.first_name} ${user.last_name}`}</h3>
          <p>{user.email}</p>
          <p>Joined: {new Date(user.created_at).toLocaleDateString()}</p>
        </div>
      </div>
      <div className="user-status">
        <span className={`status-badge status-${user.account_status}`}>
          {user.account_status}
        </span>
        {user.is_admin && (
          <span className="status-badge status-admin">Admin</span>
        )}
      </div>
      <div className="user-actions">
        <button
          onClick={() => toggleAdminStatus(user.id, user.is_admin)}
          className="action-button admin-toggle"
        >
          {user.is_admin ? 'Remove Admin' : 'Make Admin'}
        </button>
        <button
          onClick={() => toggleBanUser(user.id, user.account_status)}
          className={`action-button ban-toggle ${user.account_status === 'suspended' ? 'active' : ''}`}
        >
          {user.account_status === 'suspended' ? 'Activate' : 'Suspend'}
        </button>
      </div>
    </div>
  );

  if (loading) return <LoadingSpinner />;

  return (
    <div className="admin-users">
      <div className="page-header">
        <h1>User Management</h1>
        {successMessage && (
          <div className="success-message">{successMessage}</div>
        )}
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="empty-state">
          <h2>No users found</h2>
        </div>
      ) : (
        <div className="users-grid">
          {filteredUsers.map(user => (
            <UserCard key={user.id} user={user} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminUsers;
```

- [ ] **Step 3: Update AdminUsers CSS**

```css
/* frontend/src/styles/AdminUsers.css */
.admin-users {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  margin-bottom: 32px;
}

.page-header h1 {
  font-size: 28px;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 16px 0;
}

.search-bar {
  margin-top: 16px;
}

.search-input {
  width: 100%;
  max-width: 400px;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #1e293b;
}

.search-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.users-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 24px;
}

.user-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.user-header {
  display: flex;
  gap: 16px;
}

.user-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  background-color: #2563eb;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 600;
}

.user-info {
  flex: 1;
}

.user-info h3 {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.user-info p {
  font-size: 14px;
  color: #64748b;
  margin: 2px 0;
}

.user-status {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-active {
  background-color: #dcfce7;
  color: #166534;
}

.status-suspended {
  background-color: #fee2e2;
  color: #991b1b;
}

.status-admin {
  background-color: #dbeafe;
  color: #1e40af;
}

.user-actions {
  display: flex;
  gap: 8px;
  margin-top: auto;
}

.action-button.admin-toggle {
  flex: 1;
  background-color: #f59e0b;
  color: white;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: none;
}

.action-button.admin-toggle:hover {
  background-color: #d97706;
}

.action-button.ban-toggle {
  flex: 1;
  background-color: #64748b;
  color: white;
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border: none;
}

.action-button.ban-toggle:hover {
  background-color: #475569;
}

.action-button.ban-toggle.active {
  background-color: #10b981;
}

.action-button.ban-toggle.active:hover {
  background-color: #059669;
}

.empty-state {
  text-align: center;
  padding: 64px 24px;
}

.empty-state h2 {
  font-size: 24px;
  color: #64748b;
  margin: 0;
}

.success-message {
  background-color: #dcfce7;
  color: #166534;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .users-grid {
    grid-template-columns: 1fr;
  }

  .user-actions {
    flex-direction: column;
  }

  .search-input {
    max-width: 100%;
  }
}
```

- [ ] **Step 4: Test user management functionality**

Run: Access /admin/users, search users, toggle admin status, suspend/activate users
Expected: All actions work, UI updates correctly, search filters properly

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminUsers.js frontend/src/styles/AdminUsers.css
git commit -m "feat: implement complete user management functionality"
```

---

### Task 10: Remove Flask Admin Template Routes

**Files:**
- Modify: `backend/app.py`

- [ ] **Step 1: Find Flask admin template routes**

Read: `backend/app.py` lines 6125-6250
Action: Identify admin template routes to remove

- [ ] **Step 2: Remove Flask admin template routes**

```python
# Remove these routes from backend/app.py:
# - @admin_web_bp.route("/")
# - @admin_web_bp.route("/login")
# - @admin_web_bp.route("/logout")

# Keep these routes (they return JSON, used by React):
# - All API routes like /api/admin/users, /api/admin/approve, etc.
# - Keep admin_web_bp blueprint definition but only API routes
```

- [ ] **Step 3: Update admin_web_bp to remove template folder**

```python
# Update admin_web_bp definition around line 6126:
admin_web_bp = Blueprint(
    "admin_web",
    __name__,
    url_prefix="/admin",
    static_folder="static/admin",  # Remove this line if not needed
)
```

- [ ] **Step 4: Test that /admin routes now return React admin**

Run: Access /admin, /admin/login - should get 404 or redirect to frontend
Expected: Flask no longer serves admin templates, React handles all admin routes

- [ ] **Step 5: Test admin API endpoints still work**

Run: Test /api/admin/users, /api/admin/approve/cars
Expected: API endpoints return JSON correctly

- [ ] **Step 6: Commit**

```bash
git add backend/app.py
git commit -m "feat: remove Flask admin template routes, migration complete"
```

---

### Task 11: Final Testing and Bug Fixes

**Files:**
- All modified files

- [ ] **Step 1: Test complete admin flow**

Test: Login as admin → access admin panel → test all features
Expected: All features work, no errors, smooth navigation

- [ ] **Step 2: Test non-admin access**

Test: Login as non-admin → try to access /admin
Expected: Shows "Access Denied" page

- [ ] **Step 3: Test responsive design**

Test: Access admin panel on mobile device
Expected: Layout adapts properly, all features accessible

- [ ] **Step 4: Test error handling**

Test: Disconnect network during operations, input invalid data
Expected: Appropriate error messages, no crashes

- [ ] **Step 5: Check for console errors**

Test: Open browser console, navigate all admin pages
Expected: No JavaScript errors or warnings

- [ ] **Step 6: Verify Vercel deployment works**

Test: Deploy to Vercel, test in production
Expected: All features work in production environment

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "test: complete React admin panel migration with full testing"
```

---

## Summary

This implementation plan:

✅ **Migrates all Flask admin features to React**
- Admin dashboard with statistics
- Listings approve/reject functionality  
- Dealer management
- User management with admin status and account controls
- Modern, clean UI/UX

✅ **Eliminates 404 errors**
- All admin routes served by React on Vercel
- No server-side rendered pages needed

✅ **Maintains existing backend APIs**
- Flask backend continues to serve admin API endpoints
- No database or auth changes needed

✅ **Follows best practices**
- Component-based architecture
- Proper error handling
- Loading states and user feedback
- Responsive design
- TDD approach with testing

**Next Steps:**
1. Execute tasks sequentially using subagent-driven-development
2. Test thoroughly after each phase
3. Deploy to Vercel and Railway
4. Monitor for any issues in production
