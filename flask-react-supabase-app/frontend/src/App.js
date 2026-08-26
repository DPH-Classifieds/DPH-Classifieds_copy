import React, { useEffect, Suspense, lazy, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, useParams, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SavedListingsProvider } from './context/SavedListingsContext';
import Header from './components/Header';
import DealerPendingBanner from './components/DealerPendingBanner';
import UsernameRequiredBanner from './components/UsernameRequiredBanner';
import Footer from './components/ui/hover-footer';
import CookieBanner from './components/CookieBanner';
import LoadingSpinner from './components/LoadingSpinner';
import NotFound from './components/NotFound';
import ProtectedRoute from './components/ProtectedRoute';
import PhoneVerifiedRoute from './components/PhoneVerifiedRoute';
import PhoneGate from './components/PhoneGate';
import { DealerProvider } from './context/DealerContext';
import DealerRoute from './components/DealerRoute';
import DealerLayout from './components/DealerLayout';
import DealerDashboard from './components/dealer/DealerDashboard';
import DealerListings from './components/dealer/DealerListings';
import DealerListingAnalytics from './components/dealer/DealerListingAnalytics';
import DealerListingDiagnostic from './components/dealer/DealerListingDiagnostic';
import DealerTeam from './components/dealer/DealerTeam';
import DealerSettings from './components/dealer/DealerSettings';
import DealerInviteAccept from './components/dealer/DealerInviteAccept';
import DealerInfoRequest from './components/dealer/DealerInfoRequest';
import DealerVerificationPage from './components/DealerVerificationPage';
import PlatformAnalyticsTracker from './components/PlatformAnalyticsTracker';
import PostHogPageview from './components/PostHogPageview';
import UserBehaviorTracker from './components/UserBehaviorTracker';
import SavedListingsNotice from './components/SavedListingsNotice';
import AnnouncementBanner from './components/AnnouncementBanner';
import { ChunkLoadErrorBoundary, ChunkLoadRecovery } from './components/ChunkLoadGuard';
import './App.css';
import './styles/UAELicensePlate.css';
import './components/cropper/unifiedCropper.css';

const DealerLeads = lazy(() => import('./components/dealer/DealerLeads'));
const DealerLeadDetail = lazy(() => import('./components/dealer/DealerLeadDetail'));
const DealerInventory = lazy(() => import('./components/dealer/DealerInventory'));
const DealerInventoryJobDetail = lazy(() => import('./components/dealer/DealerInventoryJobDetail'));
const DealerApiSources = lazy(() => import('./components/dealer/DealerApiSources'));
const DealerWebhooks = lazy(() => import('./components/dealer/DealerWebhooks'));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function SiteChrome({ children }) {
  const { pathname } = useLocation();
  if (pathname.startsWith('/admin')) return null;
  return <>{children}</>;
}

// On /admin/* the consumer Header is hidden by SiteChrome, so the
// .app-content margin-top:84px would render as a black gap above the
// admin shell. Drop the className on admin routes; AdminLayout supplies
// its own sticky header.
function MainArea({ children }) {
  const { pathname } = useLocation();
  const isAdmin = pathname.startsWith('/admin');
  return <main className={isAdmin ? 'app-main--bare' : 'app-content'}>{children}</main>;
}

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
const VerifyPhone = lazy(() => import('./components/VerifyPhone'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const AuthCallback = lazy(() => import('./components/AuthCallback'));
const Profile = lazy(() => import('./components/Profile'));
const AccountSettings = lazy(() => import('./components/AccountSettings'));
const MyListings = lazy(() => import('./components/MyListings'));
const RenewListing = lazy(() => import('./components/RenewListing'));
const PostCar = lazy(() => import('./components/PostCar'));
const PostBike = lazy(() => import('./components/PostBike'));
const PostPlate = lazy(() => import('./components/PostPlate'));
const PostCarParts = lazy(() => import('./components/PostCarParts'));
const RequestCarModel = lazy(() => import('./components/RequestCarModel'));
const About = lazy(() => import('./components/About'));
const Contact = lazy(() => import('./components/Contact'));
const AdminRoute = lazy(() => import('./components/AdminRoute'));
const AdminLayout = lazy(() => import('./components/AdminLayout'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AdminUsers = lazy(() => import('./components/AdminUsers'));
const AdminUserDetail = lazy(() => import('./components/AdminUserDetail'));
const AdminListings = lazy(() => import('./components/AdminListings'));
const AdminListingDetail = lazy(() => import('./components/AdminListingDetail'));
const AdminDealers = lazy(() => import('./components/AdminDealers'));
const AdminDealerDetail = lazy(() => import('./components/AdminDealerDetail'));
const AdminDealerUpgradeRequests = lazy(() => import('./components/admin/AdminDealerUpgradeRequests'));
const AdminFeaturedListings = lazy(() => import('./components/admin/AdminFeaturedListings'));
const AdminDealershipDetail = lazy(() => import('./components/admin/AdminDealershipDetail'));
const AdminDealershipsHub = lazy(() => import('./components/admin/AdminDealershipsHub'));
const AdminDealerAuditLog = lazy(() => import('./components/admin/AdminDealerAuditLog'));
const AdminReports = lazy(() => import('./components/AdminReports'));
const AdminMetrics = lazy(() => import('./components/AdminMetrics'));
const AdminVinOpens = lazy(() => import('./components/admin/AdminVinOpens'));
const AdminTools = lazy(() => import('./components/AdminTools'));
const AdminRedditVerify = lazy(() => import('./components/admin/AdminRedditVerify'));
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const TermsOfUse = lazy(() => import('./components/TermsOfUse'));
const ExplorePage = lazy(() => import('./components/ExplorePage'));
const BuyingRequestsPage = lazy(() => import('./components/BuyingRequestsPage'));
const BuyingRequestDetail = lazy(() => import('./components/BuyingRequestDetail'));
const PostBuyingRequest = lazy(() => import('./components/PostBuyingRequest'));

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

const PostTypeRedirect = () => {
  const { type } = useParams();
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'bike' || normalized === 'bikes') {
    return <Navigate to="/post-bike" replace />;
  }
  if (normalized === 'plate' || normalized === 'plates') {
    return <Navigate to="/post-plate" replace />;
  }
  if (normalized === 'part' || normalized === 'parts' || normalized === 'car-parts' || normalized === 'carparts') {
    return <Navigate to="/post-car-parts" replace />;
  }
  return <Navigate to="/post-car" replace />;
};

const EditTypeRedirect = () => {
  const { type, id } = useParams();
  const normalized = String(type || '').toLowerCase();
  if (!id) {
    return <Navigate to="/my-listings" replace />;
  }
  if (normalized === 'bike' || normalized === 'bikes') {
    return <Navigate to={`/edit/bike/${id}`} replace />;
  }
  if (normalized === 'plate' || normalized === 'plates') {
    return <Navigate to={`/edit/plate/${id}`} replace />;
  }
  if (normalized === 'part' || normalized === 'parts' || normalized === 'car-parts' || normalized === 'carparts') {
    return <Navigate to={`/edit/part/${id}`} replace />;
  }
  return <Navigate to={`/edit/car/${id}`} replace />;
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
      <SavedListingsProvider>
        <Router>
          <ChunkLoadRecovery />
          <AuthHashHandler />
          <ScrollToTop />
          <PlatformAnalyticsTracker />
          <PostHogPageview />
          <UserBehaviorTracker />
          <div className="app">
            <SiteChrome>
              <Header />
              <AnnouncementBanner />
              <DealerPendingBanner />
              <UsernameRequiredBanner />
              <SavedListingsNotice />
            </SiteChrome>
            <MainArea>
              <ChunkLoadErrorBoundary>
                <Suspense fallback={<div className="loading"><LoadingSpinner /></div>}>
                  <PhoneGate>
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
              <Route path="/verify-phone" element={<VerifyPhone />} />
              <Route path="/request-car-model" element={<RequestCarModel />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-of-use" element={<TermsOfUse />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/reddit" element={<ExplorePage forcedCategory="reddit" />} />
              <Route path="/buying-requests" element={<BuyingRequestsPage />} />
              <Route path="/buying-requests/:id" element={<BuyingRequestDetail />} />
              <Route path="/dealer/verification" element={<DealerVerificationPage />} />

              {/* Protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<AccountSettings />} />
                <Route path="/account-settings" element={<AccountSettings />} />
                <Route path="/my-listings" element={<MyListings />} />
                <Route path="/listings/:type/:id/renew" element={<RenewListing />} />
                <Route path="/create-listing" element={<Navigate to="/post-car" replace />} />
                <Route path="/edit-listing/:id" element={<Navigate to="/my-listings" replace />} />
                <Route path="/edit/car/:id" element={<PostCar />} />
                <Route path="/edit/bike/:id" element={<PostBike />} />
                <Route path="/edit/plate/:id" element={<PostPlate />} />
                <Route path="/edit/part/:id" element={<PostCarParts />} />
                <Route path="/edit/:type/:id" element={<EditTypeRedirect />} />
                <Route element={<PhoneVerifiedRoute />}>
                  <Route path="/post-car" element={<PostCar />} />
                  <Route path="/post-bike" element={<PostBike />} />
                  <Route path="/post-plate" element={<PostPlate />} />
                  <Route path="/post-car-parts" element={<PostCarParts />} />
                  <Route path="/post-buying-request" element={<PostBuyingRequest />} />
                  <Route path="/post/:type" element={<PostTypeRedirect />} />
                </Route>
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
                <Route path="users/:userId" element={<AdminUserDetail />} />
                <Route path="listings" element={<AdminListings />} />
                <Route path="listings/:itemType/:itemId" element={<AdminListingDetail />} />
                <Route path="dealers" element={<AdminDealers />} />
                <Route path="dealers/:dealerId" element={<AdminDealerDetail />} />
                <Route path="dealer-upgrade-requests" element={<AdminDealerUpgradeRequests />} />
                <Route path="featured-listings" element={<AdminFeaturedListings />} />
                <Route path="dealerships/hub" element={<AdminDealershipsHub />} />
                <Route path="dealerships/audit-log" element={<AdminDealerAuditLog />} />
                <Route path="dealerships/:id" element={<AdminDealershipDetail />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="vin-opens" element={<AdminVinOpens />} />
                <Route path="metrics" element={<AdminMetrics />} />
                <Route path="tools" element={<AdminTools />} />
                <Route path="reddit-verify" element={<AdminRedditVerify />} />
              </Route>

              {/* Dealer routes */}
              <Route path="/dealer/invite/accept" element={<DealerInviteAccept />} />
              <Route path="/dealer-info-request/:token" element={<DealerInfoRequest />} />
              <Route path="/dealer" element={
                <DealerProvider>
                  <DealerRoute>
                    <DealerLayout />
                  </DealerRoute>
                </DealerProvider>
              }>
                <Route index element={<Navigate to="/dealer/dashboard" replace />} />
                <Route path="dashboard" element={<DealerDashboard />} />
                <Route path="listings" element={<DealerListings />} />
                <Route path="listings/:listing_type/:listing_id/analytics" element={<DealerListingAnalytics />} />
                <Route path="listings/:listing_type/:listing_id/diagnostic" element={<DealerListingDiagnostic />} />
                <Route path="leads" element={<DealerLeads />} />
                <Route path="leads/:id" element={<DealerLeadDetail />} />
                <Route path="inventory" element={<DealerInventory />} />
                <Route path="inventory/jobs/:id" element={<DealerInventoryJobDetail />} />
                <Route path="integrations" element={<DealerApiSources />} />
                <Route path="webhooks" element={<DealerWebhooks />} />
                <Route path="team" element={<DealerTeam />} />
                <Route path="settings" element={<DealerSettings />} />
              </Route>

              {/* 404 route */}
              <Route path="*" element={<NotFound />} />
                  </Routes>
                  </PhoneGate>
                </Suspense>
              </ChunkLoadErrorBoundary>
            </MainArea>
            <SiteChrome>
              <Footer />
            </SiteChrome>
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
      </SavedListingsProvider>
    </AuthProvider>
  );
}

export default App;
