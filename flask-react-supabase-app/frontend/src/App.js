import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Header from './components/Header';
import Footer from './components/Footer';
import HomePage from './components/HomePage';
import CarList from './components/CarList';
import CarDetail from './components/CarDetail';
import CarParts from './components/CarParts';
import Plates from './components/Plates';
import Bikes from './components/Bikes';
import PlateDetail from './components/PlateDetail';
import BikeDetail from './components/BikeDetail';
import PartDetail from './components/PartDetail';
import Login from './components/Login';
import Signup from './components/Signup';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import Profile from './components/Profile';
import Settings from './components/Settings';
import MyListings from './components/MyListings';
import CreateListing from './components/CreateListing';
import EditListing from './components/EditListing';
import PostCar from './components/PostCar';
import PostBike from './components/PostBike';
import PostPlate from './components/PostPlate';
import PostCarParts from './components/PostCarParts';
import ProtectedRoute from './components/ProtectedRoute';
import NotFound from './components/NotFound';
import About from './components/About';
import Contact from './components/Contact';
import AdminDashboard from './components/AdminDashboard';
import AdminUsers from './components/AdminUsers';
import AdminTools from './components/AdminTools';
import './App.css';
import './styles/UAELicensePlate.css';

function App() {
  return (
    <AuthProvider>
      <Router>
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
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              
              {/* Protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/my-listings" element={<MyListings />} />
                <Route path="/create-listing" element={<CreateListing />} />
                <Route path="/edit-listing/:id" element={<EditListing />} />
                <Route path="/post-car" element={<PostCar />} />
                <Route path="/post-bike" element={<PostBike />} />
                <Route path="/post-plate" element={<PostPlate />} />
                <Route path="/post-car-parts" element={<PostCarParts />} />
              </Route>
              
              {/* Admin routes */}
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/tools" element={<AdminTools />} />
              
              {/* 404 route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
