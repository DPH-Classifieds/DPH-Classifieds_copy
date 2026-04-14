import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AuthProvider } from './context/AuthContext';
import Header from './components/Header';
import Footer from './components/ui/hover-footer';
import CookieBanner from './components/CookieBanner';
import HomePage from './components/HomePage';
import CarList from './components/CarList';
import CarDetail from './components/CarDetail';
import CarParts from './components/CarParts';
import Plates from './components/PlatesRedesigned';
import Bikes from './components/BikesRedesigned';
import PlateDetail from './components/PlateDetailRedesigned';
import BikeDetail from './components/BikeDetailRedesigned';
import PartDetail from './components/PartDetailRedesigned';
import Login from './components/Login';
import Signup from './components/Signup';
import CheckEmail from './components/CheckEmail';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import AuthCallback from './components/AuthCallback';
import Profile from './components/Profile';
import AccountSettings from './components/AccountSettings';
import MyListings from './components/MyListings';
import CreateListing from './components/CreateListing';
import EditListing from './components/EditListing';
import PostCar from './components/PostCar';
import PostBike from './components/PostBike';
import PostPlate from './components/PostPlate';
import PostCarParts from './components/PostCarParts';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import NotFound from './components/NotFound';
import About from './components/About';
import Contact from './components/Contact';
import AdminDashboard from './components/AdminDashboard';
import AdminUsers from './components/AdminUsers';
import PrivacyPolicy from './components/PrivacyPolicy';
import TermsOfUse from './components/TermsOfUse';
import ExplorePage from './components/ExplorePage';
import './App.css';
import './styles/UAELicensePlate.css';

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
  return (
    <AuthProvider>
      <Router>
        <AuthHashHandler />
        <div className="app">
          <Header />
          <main className="app-content">
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
              <Route path="/privacy-policy" element={<PrivacyPolicy />} /> {/* Added Privacy Policy route */}
              <Route path="/terms-of-use" element={<TermsOfUse />} /> {/* Added Terms of Use route */}
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
              <Route element={<AdminRoute />}>
                <Route path="/admin" element={<AdminDashboard />} />
                <Route path="/admin/users" element={<AdminUsers />} />
              </Route>
              
              {/* 404 route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
        <CookieBanner />
        <Analytics />
        <SpeedInsights />
      </Router>
    </AuthProvider>
  );
}

export default App;
