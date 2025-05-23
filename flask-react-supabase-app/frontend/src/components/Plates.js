import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/Plates.css';
import '../styles/UAELicensePlate.css';
import UAELicensePlate from './UAELicensePlate';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Plates = () => {
  const [plates, setPlates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cities, setCities] = useState([]);
  const [codes, setCodes] = useState([]);
  const [debugInfo, setDebugInfo] = useState('');
  const [filters, setFilters] = useState({
    city: 'All cities',
    code: 'All codes',
    digits: '',
    contains: '',
    priceMin: '',
    priceMax: '',
    startsWith: '',
    endsWith: '',
    format: 'Any format',
    sortBy: 'newest'
  });
  const { user } = useAuth();

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

  // Define UAE cities
  const cityOptions = [
    'All cities',
    'Dubai',
    'Abu Dhabi',
    'Sharjah',
    'Ajman',
    'Ras Al Khaimah',
    'Fujairah',
    'Umm Al Quwain'
  ];

  // Define digits options
  const digitsOptions = [
    'Any digits',
    '1',
    '2',
    '3',
    '4',
    '5'
  ];

  // Define fetchPlates outside useEffect so it can be called directly
  const fetchPlates = async () => {
    try {
      setLoading(true);
      // Diagnostic info
      const diagnosticInfo = {
        apiClientType: typeof apiClient,
        getMethodExists: typeof apiClient?.get === 'function',
        apiClientKeys: Object.keys(apiClient || {}).join(', '),
        userLoggedIn: !!user,
        userEmail: user?.email || 'Not logged in',
        location: window.location.href,
        timestamp: new Date().toISOString()
      };
      
      setDebugInfo(JSON.stringify(diagnosticInfo, null, 2));
      console.log('Diagnostic info:', diagnosticInfo);
      console.log('Fetching plates from API...');
      
      // First try using a direct fetch to diagnose issues
      try {
        // Add timestamp to avoid caching
        const timestamp = new Date().getTime();
        const directResponse = await fetch(`http://localhost:8000/api/plates?_t=${timestamp}`);
        console.log('Direct fetch response:', {
          status: directResponse.status,
          ok: directResponse.ok,
          statusText: directResponse.statusText
        });
        
        if (directResponse.ok) {
          const directData = await directResponse.json();
          console.log('Direct fetch data:', directData && directData.length ? 
                       `Found ${directData.length} plates` : 'No plates or invalid data');
          if (directData && directData.length) {
            console.log('Direct fetch status breakdown:', {
              total: directData.length,
              approved: directData.filter(p => p.status === 'approved').length,
              pending: directData.filter(p => p.status === 'pending').length,
              rejected: directData.filter(p => p.status === 'rejected').length,
              other: directData.filter(p => !['approved', 'pending', 'rejected'].includes(p.status)).length
            });
            console.log('Sample plate from direct fetch:', directData[0]);
          }
        }
      } catch (fetchErr) {
        console.error('Direct fetch failed:', fetchErr);
      }
      
      // Now try with the apiClient
      try {
        console.log('Using apiClient to fetch plates...');
        // Add timestamp to avoid caching
        const timestamp = new Date().getTime();
        const response = await apiClient.get(`/api/plates?_t=${timestamp}`);
        console.log('Received plates from apiClient:', response);
        
        if (Array.isArray(response)) {
          console.log('Status breakdown:', {
            total: response.length,
            approved: response.filter(p => p.status === 'approved').length,
            pending: response.filter(p => p.status === 'pending').length,
            rejected: response.filter(p => p.status === 'rejected').length,
            other: response.filter(p => !['approved', 'pending', 'rejected'].includes(p.status)).length
          });
          
          // Filter out non-approved plates
          const approvedPlates = response.filter(plate => plate.status === 'approved');
          console.log(`Found ${approvedPlates.length} approved plates`);
          
          if (approvedPlates.length > 0) {
            console.log('Sample approved plate:', approvedPlates[0]);
          } else {
            console.log('No approved plates found. All plates:', response);
          }
          
          setPlates(approvedPlates);
          
          // Extract unique cities and codes for filters
          const uniqueCities = [...new Set(approvedPlates.map(plate => plate.city))];
          const uniqueCodes = [...new Set(approvedPlates.map(plate => plate.code))];
          setCities(uniqueCities);
          setCodes(uniqueCodes);
          setError(null);
        } else {
          console.error('Unexpected response format:', response);
          setError('Failed to load plates. Response was not an array.');
          setPlates([]);
        }
      } catch (apiErr) {
        console.error('apiClient.get failed:', apiErr);
        setError(`API client error: ${apiErr.message}`);
      }
    } catch (err) {
      console.error('Error in overall fetch process:', err);
      setError(`Failed to load plates: ${err.message}`);
      setPlates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlates();
  }, [user]);

  // Add useEffect to update code options based on selected city
  useEffect(() => {
    if (filters.city === 'Dubai') {
      // Dubai-specific codes (include both single letters and special codes)
      const dubaiCodes = [
        ...Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)),
        'AA', 'BB', 'CC', 'DD', 'CR'
      ];
      setCodes(dubaiCodes);
    } else if (filters.city === 'Abu Dhabi') {
      // Numbers from 1 to 20, plus 50
      setCodes([...Array.from({length: 20}, (_, i) => (i + 1).toString()), '50']);
    } else if (filters.city === 'Sharjah') {
      // Numbers from 1 to 10
      setCodes([...Array.from({length: 10}, (_, i) => (i + 1).toString())]);
    } else if (filters.city === 'All cities') {
      // Get codes from plates if available
      if (plates.length > 0) {
        const uniqueCodes = [...new Set(plates.map(plate => plate.code))];
        setCodes(uniqueCodes);
      }
    } else {
      // A to Z for other cities
      setCodes(Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i)));
    }
  }, [filters.city, plates]);

  // Filter plates based on current filters
  const filteredPlates = plates.filter(plate => {
    if (filters.city !== 'All cities' && plate.city !== filters.city) return false;
    if (filters.code !== 'All codes' && plate.code !== filters.code) return false;
    if (filters.priceMin && plate.price < parseFloat(filters.priceMin)) return false;
    if (filters.priceMax && plate.price > parseFloat(filters.priceMax)) return false;
    
    // New filters
    if (filters.digits && plate.number && plate.number.length !== parseInt(filters.digits)) return false;
    if (filters.contains && !plate.number.includes(filters.contains)) return false;
    if (filters.startsWith && !plate.number.startsWith(filters.startsWith)) return false;
    if (filters.endsWith && !plate.number.endsWith(filters.endsWith)) return false;
    if (filters.format !== 'Any format' && plate.plate_format !== filters.format) return false;
    
    return true;
  });

  // Sort plates based on current sort option
  const sortedPlates = [...filteredPlates].sort((a, b) => {
    switch (filters.sortBy) {
      case 'newest':
        return new Date(b.created_at) - new Date(a.created_at);
      case 'oldest':
        return new Date(a.created_at) - new Date(b.created_at);
      case 'price_low':
        return a.price - b.price;
      case 'price_high':
        return b.price - a.price;
      default:
        return 0;
    }
  });

  // Replace the plate item rendering with our new component
  const renderPlateCard = (plate) => {
    return (
      <div key={plate.id} className="plate-card">
        <Link to={`/plates/${plate.id}`} className="plate-card-link">
          <div className="plate-image">
            <UAELicensePlate 
              city={plate.city}
              code={plate.code}
              number={plate.number}
              className={plate.status === 'sold' ? 'sold' : ''}
            />
          </div>
          <div className="plate-details">
            <h3>{plate.city} Plate {plate.code} {plate.number}</h3>
            <p className="plate-price">AED {plate.price?.toLocaleString()}</p>
            <p className="plate-date">Listed on {new Date(plate.created_at).toLocaleDateString()}</p>
          </div>
        </Link>
      </div>
    );
  };

  // Handle search button click
  const handleSearch = (e) => {
    e.preventDefault();
    // The filtering is already reactive, but we could add additional logic here if needed
    console.log("Searching with filters:", filters);
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading plates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        {process.env.NODE_ENV === 'development' && (
          <div className="debug-info">
            <h3>Debug Information (Dev Only)</h3>
            <p>API Client Status: {typeof apiClient === 'object' ? 'Available' : 'Not available'}</p>
            <p>GET Method: {typeof apiClient?.get === 'function' ? 'Available' : 'Not available'}</p>
            <p>API URL: {API_URL}</p>
            <p>User: {user ? user.email : 'Not logged in'}</p>
            <pre>{debugInfo}</pre>
            
            <div className="debug-actions">
              <button 
                onClick={() => window.location.reload()} 
                className="debug-btn"
              >
                Reload Page
              </button>
              <button 
                onClick={async () => {
                  try {
                    const response = await fetch(`${API_URL}/api/plates`);
                    const data = await response.json();
                    console.log('Direct fetch result:', data);
                    alert(`Direct fetch found ${data.length} plates`);
                  } catch (err) {
                    console.error('Direct fetch failed:', err);
                    alert(`Direct fetch failed: ${err.message}`);
                  }
                }}
                className="debug-btn"
              >
                Test Direct Fetch
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="plates-container">
      <div className="plates-header">
        <h1>Search</h1>
        
        <form className="search-form" onSubmit={handleSearch}>
          <div className="search-filters">
            <div className="search-row">
              <select
                value={filters.city}
                onChange={(e) => setFilters(prev => ({ ...prev, city: e.target.value }))}
                className="filter-input"
              >
                {cityOptions.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
              
              <select
                value={filters.code}
                onChange={(e) => setFilters(prev => ({ ...prev, code: e.target.value }))}
                className="filter-input"
              >
                <option value="All codes">All codes</option>
                {codes.map(code => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </select>
              
              <select 
                value={filters.digits || 'Any digits'}
                onChange={(e) => setFilters(prev => ({ 
                  ...prev, 
                  digits: e.target.value === 'Any digits' ? '' : e.target.value 
                }))}
                className="filter-input"
              >
                {digitsOptions.map(digit => (
                  <option key={digit} value={digit}>{digit}</option>
                ))}
              </select>
              
              <input 
                type="text" 
                placeholder="Contains: ex:900" 
                value={filters.contains}
                onChange={(e) => setFilters(prev => ({ ...prev, contains: e.target.value }))}
                className="filter-input"
              />
            </div>
            
            <div className="search-row">
              <input 
                type="text" 
                placeholder="Maximum price" 
                value={filters.priceMax}
                onChange={(e) => setFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                className="filter-input"
              />
              
              <input 
                type="text" 
                placeholder="Minimum price" 
                value={filters.priceMin}
                onChange={(e) => setFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                className="filter-input"
              />
              
              <input 
                type="text" 
                placeholder="Starts with: ex:123" 
                value={filters.startsWith}
                onChange={(e) => setFilters(prev => ({ ...prev, startsWith: e.target.value }))}
                className="filter-input"
              />
              
              <input 
                type="text" 
                placeholder="Ends with: ex:000" 
                value={filters.endsWith}
                onChange={(e) => setFilters(prev => ({ ...prev, endsWith: e.target.value }))}
                className="filter-input"
              />
            </div>
            
            <div className="search-row">
              <select 
                value={filters.format}
                onChange={(e) => setFilters(prev => ({ ...prev, format: e.target.value }))}
                className="filter-input"
              >
                {plateFormatOptions.map(format => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </select>
              
              <button type="submit" className="search-button">
                <span className="search-icon">🔍</span> Search
              </button>
            </div>
          </div>
        </form>
      </div>
      
      <div className="plates-results">
        <div className="results-count">
          Showing {sortedPlates.length} license plates
        </div>
        
        <div className="plates-grid">
          {sortedPlates.length > 0 ? (
            sortedPlates.map(plate => renderPlateCard(plate))
          ) : (
            <div className="no-results">
              <p>No license plates match your filters</p>
              <button 
                onClick={() => setFilters({
                  city: 'All cities',
                  code: 'All codes',
                  digits: '',
                  contains: '',
                  priceMin: '',
                  priceMax: '',
                  startsWith: '',
                  endsWith: '',
                  format: 'Any format',
                  sortBy: 'newest'
                })}
                className="reset-filters-btn"
              >
                Reset Filters
              </button>
            </div>
          )}
        </div>
      </div>
      
      <div className="plate-sell-cta">
        <div className="cta-content">
          <h2>Sell Your License Plate</h2>
          <p>List your license plate for free and reach thousands of interested buyers.</p>
          <Link to="/post-plate" className="sell-plate-btn">Post Your License Plate</Link>
        </div>
      </div>
    </div>
  );
};

export default Plates; 