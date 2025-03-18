import React, { useEffect, useState } from 'react';
import './App.css';

// The API base URL
const API_BASE_URL = 'http://localhost:8000';

function App() {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [usingTestData, setUsingTestData] = useState(false);

  // Function to directly check API status
  const checkApiStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/`);
      if (response.ok) {
        const data = await response.json();
        setApiStatus(data.message);
        return true;
      } else {
        setApiStatus(`API Error: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (err) {
      setApiStatus(`API Connection Error: ${err.message}`);
      return false;
    }
  };

  // Function to fetch car data 
  const fetchCarData = async (useTestEndpoint = false) => {
    try {
      setLoading(true);
      setError(null);
      setUsingTestData(useTestEndpoint);
      
      // First check if API is responding
      if (!useTestEndpoint) {
        const apiAvailable = await checkApiStatus();
        
        if (!apiAvailable) {
          throw new Error('API is not available');
        }
      }
      
      // Then fetch the car data
      const endpoint = useTestEndpoint ? `${API_BASE_URL}/api/test` : `${API_BASE_URL}/api/data`;
      console.log(`Fetching from: ${endpoint}`);
      
      const response = await fetch(endpoint);
      
      if (!response.ok) {
        if (!useTestEndpoint) {
          // Try the test endpoint as fallback
          console.log("Main endpoint failed, trying test endpoint");
          return fetchCarData(true);
        }
        throw new Error(`Network error: ${response.status} ${response.statusText}`);
      }
      
      const responseText = await response.text();
      console.log('Raw response:', responseText);
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (jsonError) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
      
      setCars(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(err.message);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCarData();
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Car Listings</h1>
        {apiStatus && <p className="api-status">API Status: {apiStatus}</p>}
        {usingTestData && <p className="warning">Using test data (not from Supabase)</p>}
      </header>
      
      {loading ? (
        <div className="loading">Loading car data...</div>
      ) : error ? (
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => fetchCarData()}>Retry</button>
          <button onClick={() => fetchCarData(true)} className="secondary">
            Use Test Data
          </button>
        </div>
      ) : (
        <main>
          {cars.length === 0 ? (
            <p>No cars found. Please add some data to your Supabase table.</p>
          ) : (
            <div className="car-grid">
              {cars.map(car => (
                <div className="car-card" key={car.id}>
                  <h2>{car.make} {car.model}</h2>
                  <p><strong>Year:</strong> {car.year}</p>
                  <p><strong>Price:</strong> ${car.price}</p>
                </div>
              ))}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

export default App;
