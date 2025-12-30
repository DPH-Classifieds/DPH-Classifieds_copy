import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
// eslint-disable-next-line no-unused-vars
import { getBestAccessToken } from '../utils/supabaseClient';
import apiClient from '../utils/apiClient';
import html2canvas from 'html2canvas';
import '../styles/PostForms.css';
import '../styles/UAELicensePlate.css';
import UAELicensePlate from './UAELicensePlate';

const PostPlate = () => {
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [formData, setFormData] = useState({
    city: '',
    code: '',
    digits: '',
    price: '',
    number: '',
    plate_format: 'Any format',
    contact_name: '',
    contact_phone: '',
    description: '',
    is_dealer: false
  });
  const [codeOptions, setCodeOptions] = useState([]);
  // eslint-disable-next-line no-unused-vars
  const [debugInfo, setDebugInfo] = useState('');
  const [showDebug, setShowDebug] = useState(false);

  const platePreviewRef = useRef(null);

  // Check if user is logged in when component loads
  useEffect(() => {
    const checkAuth = async () => {
      console.log('PostPlate: Checking authentication status');
      
      // Make two attempts to sync with Supabase
      await syncWithSupabase();
      
      // If still not authenticated after sync, try a forced login refresh
      if (!user && !isLoading) {
        console.log('User not authenticated after sync, showing auth modal');
        
        // Check if we have a token in localStorage
        const storedToken = localStorage.getItem('supabase_access_token');
        if (storedToken) {
          console.log('Found token in localStorage, attempting to validate');
          try {
            // Try to use the token to get user info
            const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL || 'https://ltjatsyhpmvewancqdjw.supabase.co'}/auth/v1/user`, {
              headers: {
                'Authorization': `Bearer ${storedToken}`,
                'apikey': process.env.REACT_APP_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0amF0c3locG12ZXdhbmNxZGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIzMjAxMDQsImV4cCI6MjA1Nzg5NjEwNH0.k7stpvp2saDgVlqv9d-alX0sMsyQtFMWeYHdojZ68I8'
              }
            });
            
            if (response.ok) {
              console.log('Token is valid, forcing a sync');
              await syncWithSupabase();
            } else {
              console.warn('Stored token validation failed, status:', response.status);
              localStorage.removeItem('supabase_access_token');
              setShowAuthModal(true);
            }
          } catch (error) {
            console.error('Error validating token:', error);
            localStorage.removeItem('supabase_access_token');
            setShowAuthModal(true);
          }
        } else {
          console.log('No token found in localStorage');
          setShowAuthModal(true);
        }
      } else if (user) {
        console.log('User authenticated:', user.email);
        setShowAuthModal(false);
      }
    };
    
    checkAuth();
  }, [user, isLoading, syncWithSupabase]);

  // Define plate format options
  const plateFormatOptions = [
    'Any format',
    'Contains digit repeated 2 times',
    'Contains digit repeated 3 times',
    'Contains digit repeated 4 times',
    'x???x (5 Digits)',
    'xyzyx (5 Digits)',
    'xxxX (5 Digits)',
    '?xxx? (5 Digits)',
    'хухух (5 Digits)',
    'хууух (5 Digits)',
    '??xxx (5 Digits)',
    'XXX?? (5 Digits)',
    'xXXXx (5 Digits)',
    'x??X (4 Digits)',
    'xyyx (4 Digits)',
    'xyxy (4 Digits)',
    '?xx? (4 Digits)',
    'xxxy (4 Digits)',
    'ХУУУ (4 Digits)',
    'XXXX (4 Digits)',
    'xyx (3 Digits)',
    'xyz (3 Digits)',
    'xyy (3 Digits)',
    'xxy (3 Digits)',
    'XXX (3 Digits)'
  ];

  // Authentication modal component
  const AuthModal = () => {
    return (
      <div className="auth-modal-overlay">
        <div className="auth-modal">
          <h2>Authentication Required</h2>
          <p>Please log in or sign up to post a listing.</p>
          <div className="auth-modal-buttons">
            <button 
              onClick={() => navigate('/login')}
              className="btn btn-primary"
            >
              Log In
            </button>
            <button 
              onClick={() => navigate('/signup')}
              className="btn btn-secondary"
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Update code options based on selected city
  useEffect(() => {
    if (formData.city) {
      switch (formData.city) {
        case 'Dubai':
          // A to Z (26 English letters) plus special codes including EE
          setCodeOptions([
            ...Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)),
            'AA', 'BB', 'CC', 'DD', 'EE', 'CR'
          ]);
          break;
        case 'Abu Dhabi':
          // Numbers from 1 to 20, plus 50
          setCodeOptions([...Array.from({length: 20}, (_, i) => (i + 1).toString()), '50']);
          break;
        case 'Sharjah':
          // Code White, 1, 2, and 3 only
          setCodeOptions(['White', '1', '2', '3']);
          break;
        case 'Ajman':
        case 'Ras Al Khaimah':
        case 'Fujairah':
        case 'Umm Al Quwain':
          // A to Z (26 English letters) for all other cities
          setCodeOptions(Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)));
          break;
        default:
          setCodeOptions([]);
      }
      
      // Reset the selected code when city changes
      setFormData(prev => ({
        ...prev,
        code: ''
      }));
    } else {
      setCodeOptions([]);
    }
  }, [formData.city]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Check authentication first - more robust check
    console.log('Submit button clicked, checking authentication...');
    console.log('Current user state:', user ? `User ${user.email} (has token: ${!!user.access_token})` : 'No user');
    
    // Force a sync before proceeding
    await syncWithSupabase();
    
    if (!user) {
      console.log('User still not authenticated after sync, showing auth modal');
      setError('You must be logged in to post a listing');
      setShowAuthModal(true);
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      console.log('Starting plate submission process...');
      
      // First, capture the plate preview as an image
      if (!platePreviewRef.current) {
        throw new Error('Plate preview element not found');
      }
      
      // Find the actual license plate element within the preview
      const plateElement = platePreviewRef.current.querySelector('.uae-license-plate');
      if (!plateElement) {
        throw new Error('License plate element not found in the preview');
      }
      
      console.log('Capturing license plate image...');
      
      // Use html2canvas to capture the plate as an image
      const canvas = await html2canvas(plateElement, {
        backgroundColor: null,
        scale: 2, // Higher resolution
        logging: false,
        useCORS: true // Allow images from other domains
      });
      
      // Convert canvas to blob
      const plateImageBlob = await new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), 'image/png', 0.95);
      });
      
      // Create a file object from the blob
      const plateImageFile = new File(
        [plateImageBlob],
        `plate_${formData.city}_${formData.code}_${formData.number}.png`,
        { type: 'image/png' }
      );
      
      console.log('Plate image created:', plateImageFile.name);
      
      // Create FormData for submission
      const submissionData = new FormData();
      
      // Add all text fields to the FormData
      for (const key in formData) {
        if (key !== 'images' && typeof formData[key] !== 'object') {
          submissionData.append(key, formData[key]);
        }
      }
      
      // Add the plate image
      submissionData.append('plate_image', plateImageFile);
      
      // Submit to the API
      const response = await apiClient.post('/api/plates', submissionData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      console.log('Plate listed successfully:', response);
      setSuccess(true);
      
      // Redirect to Plates page after 2 seconds
      setTimeout(() => {
        navigate('/plates');
      }, 2000);
      
    } catch (error) {
      console.error('Error creating plate listing:', error);
      const apiMessage = error.response?.data?.error;
      if (apiMessage) {
        setError(apiMessage);
      } else {
        setError(`Failed to list your plate: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview of the license plate
  const PlatePreview = () => {
    if (!formData.city || !formData.code) {
      return (
        <div className="plate-preview-message">
          Select a city and code to see the plate preview
        </div>
      );
    }

    return (
      <div className="plate-preview-wrapper">
        <h3>License Plate Preview</h3>
        <div ref={platePreviewRef}>
          <UAELicensePlate 
            city={formData.city}
            code={formData.code}
            number={formData.number || '12345'}
          />
        </div>
        <div className="plate-info">
          <div>Format: {formData.plate_format}</div>
          <div>Price: AED {formData.price || '0'}</div>
        </div>
      </div>
    );
  };

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your license plate listing has been successfully submitted and is pending approval.</p>
        <p>You will be redirected to your listings page shortly...</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      {showAuthModal && <AuthModal />}
      
      <div className="post-form-header">
        <h1>Post a License Plate for Sale</h1>
        <p>Fill in the details below to list your license plate on our marketplace</p>
      </div>
      
      {error && (
        <div className="form-error-message">
          {error}
          <button 
            className="btn-link" 
            style={{marginLeft: '10px', color: '#666'}}
            onClick={() => setShowDebug(!showDebug)}
          >
            {showDebug ? 'Hide Details' : 'Show Details'}
          </button>
          {showDebug && debugInfo && (
            <pre style={{marginTop: '10px', fontSize: '12px', whiteSpace: 'pre-wrap'}}>
              {debugInfo}
            </pre>
          )}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="post-form">
        <div className="form-section">
          <h2>Plate Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="city">City *</label>
              <select
                id="city"
                name="city"
                value={formData.city}
                onChange={handleChange}
                required
              >
                <option value="">Select City</option>
                <option value="Dubai">Dubai</option>
                <option value="Abu Dhabi">Abu Dhabi</option>
                <option value="Sharjah">Sharjah</option>
                <option value="Ajman">Ajman</option>
                <option value="Fujairah">Fujairah</option>
                <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                <option value="Umm Al Quwain">Umm Al Quwain</option>
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="plate_format">Plate Format *</label>
              <select
                id="plate_format"
                name="plate_format"
                value={formData.plate_format}
                onChange={handleChange}
                required
              >
                {plateFormatOptions.map((format, index) => (
                  <option key={index} value={format}>{format}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="code">Plate Code *</label>
              <select
                id="code"
                name="code"
                value={formData.code}
                onChange={handleChange}
                required
                disabled={!formData.city}
              >
                <option value="">Select Code</option>
                {codeOptions.map((code, index) => (
                  <option key={index} value={code}>{code}</option>
                ))}
              </select>
              {!formData.city && (
                <p className="form-note">Please select a city first</p>
              )}
            </div>
            
            <div className="form-group">
              <label htmlFor="number">Plate Number *</label>
              <input
                type="text"
                id="number"
                name="number"
                value={formData.number}
                onChange={(e) => {
                  // Only allow numbers
                  const value = e.target.value.replace(/[^0-9]/g, '');
                  handleChange({ target: { name: 'number', value } });
                }}
                required
                placeholder="e.g., 123, 55, 9999"
                pattern="[0-9]*"
                inputMode="numeric"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="digits">Number of Digits *</label>
              <select
                id="digits"
                name="digits"
                value={formData.digits}
                onChange={handleChange}
                required
              >
                <option value="">Select Digits</option>
                <option value="1">1 Digit</option>
                <option value="2">2 Digits</option>
                <option value="3">3 Digits</option>
                <option value="4">4 Digits</option>
                <option value="5">5 Digits</option>
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="price">Price (AED) *</label>
              <input
                type="number"
                id="price"
                name="price"
                value={formData.price}
                onChange={handleChange}
                onInput={(e) => {
                  // Prevent negative values
                  if (e.target.value < 1) e.target.value = '';
                }}
                required
                placeholder="e.g., 15000"
                min="1"
                step="1"
              />
            </div>
          </div>
          
          <PlatePreview />
        </div>
        
        <div className="form-section">
          <h2>Contact Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contact_name">Contact Name *</label>
              <input
                type="text"
                id="contact_name"
                name="contact_name"
                value={formData.contact_name}
                onChange={handleChange}
                required
                placeholder="Your full name"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="contact_phone">Contact Phone Number *</label>
              <input
                type="tel"
                id="contact_phone"
                name="contact_phone"
                value={formData.contact_phone}
                onChange={handleChange}
                required
                placeholder="e.g., +971501234567"
              />
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Additional Information</h2>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows="4"
                placeholder="Provide any additional information about the plate, history, or reasons for selling"
              ></textarea>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Are you a dealer?</label>
              <div className="radio-group" style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
                <label className="radio-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="is_dealer"
                    value="yes"
                    checked={formData.is_dealer === true}
                    onChange={() => setFormData(prev => ({ ...prev, is_dealer: true }))}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                  <span>Yes</span>
                </label>
                <label className="radio-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="is_dealer"
                    value="no"
                    checked={formData.is_dealer === false}
                    onChange={() => setFormData(prev => ({ ...prev, is_dealer: false }))}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                  <span>No</span>
                </label>
              </div>
              <small className="form-text text-muted">Select "Yes" if you are posting this listing as a plate dealer</small>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Plate Image</h2>
          <p className="form-note">The license plate preview shown above will be used as the image for your listing. No additional images are required.</p>
        </div>
        
        <div className="form-actions">
          <button 
            type="submit" 
            className="submit-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Listing'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PostPlate; 
