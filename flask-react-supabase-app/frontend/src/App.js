import React, { useEffect, Suspense, lazy, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Header from './components/Header';
import Footer from './components/ui/hover-footer';
import CookieBanner from './components/CookieBanner';
import LoadingSpinner from './components/LoadingSpinner';
import NotFound from './components/NotFound';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import AdminLayout from './components/AdminLayout';
import './App.css';
import './styles/UAELicensePlate.css';

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(139,214,180,0.9)',
        color: '#041008',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        zIndex: 9999,
        transition: 'opacity 0.3s, transform 0.3s',
      }}
      aria-label="Back to top"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </button>
  );
}

const Analytics = lazy(() => import('./components/Analytics'));
const SpeedInsights = lazy(() => import('./components/SpeedInsights'));

const HomePage = lazy(() => import('./components/HomePage'));
const CarList = lazy(() => import('./components/CarList'));
const CarDetail = lazy(() => import('./components/CarDetail'));
const CarParts = lazy(() => import('./components/CarParts'));
const Plates = lazy(() => import('./components/PlatesRedesigned'));
const Bikes = lazy(() => import('./components/BikesRedesigned'));
const PlateDetail = lazy(() => import('./components/PlateDetailRedesigned'));
const BikeDetail = lazy(() => import('./components/BikeDetailRedesigned'));
const PartDetail = lazy(() => import('./components/PartDetailRedesigned'));
const Login = lazy(() => import('./components/Login'));
const Signup = lazy(() => import('./components/Signup'));
const CheckEmail = lazy(() => import('./components/CheckEmail'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const Profile = lazy(() => import('./components/Profile'));
const AccountSettings = lazy(() => import('./components/AccountSettings'));
const MyListings = lazy(() => import('./components/MyListings'));
const CreateListing = lazy(() => import('./components/CreateListing'));
const EditListing = lazy(() => import('./components/EditListing'));
const PostCar = lazy(() => import('./components/PostCar'));
const PostBike = lazy(() => import('./components/PostBike'));
const PostPlate = lazy(() => import('./components/PostPlate'));
const PostCarParts = lazy(() => import('./components/PostCarParts'));
const About = lazy(() => import('./components/About'));
const Contact = lazy(() => import('./components/Contact'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AdminUsers = lazy(() => import('./components/AdminUsers'));
const AdminListings = lazy(() => import('./components/AdminListings'));
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const TermsOfUse = lazy(() => import('./components/TermsOfUse'));
const ExplorePage = lazy(() => import('./components/ExplorePage'));

const AuthHashHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) {
      return;
    }

    const params = new URLSearchParams(hash.substring(1));
    const type = params.get('type');
    const hasToken = Boolean(params.get('access_token') || params.get('refresh_token'));

    if (!type && !hasToken) {
      return;
    }

    if (type === 'recovery') {
      if (location.pathname !== '/reset-password') {
        navigate(`/reset-password${hash}`, { replace: true });
      }
      return;
    }

    if (location.pathname !== '/auth/callback') {
      navigate(`/auth/callback${hash}`, { replace: true });
    }
  }, [location.pathname, navigate]);

  return null;
};

function App() {
  const [showAnalytics, setShowAnalytics] = useState(false);
  const telemetryEnabled = process.env.REACT_APP_ENABLE_VERCEL_TELEMETRY === 'true';

  useEffect(() => {
    if (!telemetryEnabled) {
      return undefined;
    }

    const handleInteraction = () => {
      if (!showAnalytics) {
        setShowAnalytics(true);
      }
    };

    const events = ['click', 'scroll', 'keydown', 'touchstart'];
    events.forEach(event => window.addEventListener(event, handleInteraction, { once: true, passive: true }));

    const timeout = setTimeout(() => setShowAnalytics(true), 5000);
    return () => {
      clearTimeout(timeout);
      events.forEach(event => window.removeEventListener(event, handleInteraction));
    };
  }, [showAnalytics, telemetryEnabled]);

  return (
    <AuthProvider>
      <Router>
        <AuthHashHandler />
        <div className="app">
          <Header />
          <main className="app-content">
            <Suspense fallback={<div className="loading"><LoadingSpinner /></div>}>
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<HomePage />} />
                <Route path="/cars" element={<CarList />} />
                <Route path="/cars/:id" element={<CarDetail />} />
                <Route path="/car-parts" element={<CarParts />} />
                <Route path="/car-parts/:id" element={<PartDetail />} />
                <Route path="/plates" element={<Plates />} />
                <Route path="/plates/:id" element={<PlateDetail />} />
                <Route path="/bikes" element={<Bikes />} />
                <Route path="/bikes/:id" element={<BikeDetail />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route path="/check-email" element={<CheckEmail />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/terms-of-use" element={<TermsOfUse />} />
                <Route path="/explore" element={<ExplorePage />} />
                
                {/* Protected routes */}
                <Route element={<ProtectedRoute />}>
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/settings" element={<AccountSettings />} />
                  <Route path="/account-settings" element={<AccountSettings />} />
                  <Route path="/my-listings" element={<MyListings />} />
                  <Route path="/create-listing" element={<CreateListing />} />
                  <Route path="/edit-listing/:id" element={<EditListing />} />
                  <Route path="/post-car" element={<PostCar />} />
                  <Route path="/post-bike" element={<PostBike />} />
                  <Route path="/post-plate" element={<PostPlate />} />
                  <Route path="/post-car-parts" element={<PostCarParts />} />
                </Route>
                
                {/* Admin routes */}
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
                  <Route path="listings" element={<AdminListings />} />
                  <Route path="dealers" element={<AdminDashboard />} />
                  <Route path="reports" element={<AdminDashboard />} />
                </Route>
                
                {/* 404 route */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
        <CookieBanner />
        <BackToTop />
        {telemetryEnabled && showAnalytics && (
          <Suspense fallback={null}>
            <Analytics />
            <SpeedInsights />
          </Suspense>
        )}
      </Router>
    </AuthProvider>
  );
}

export default App;
