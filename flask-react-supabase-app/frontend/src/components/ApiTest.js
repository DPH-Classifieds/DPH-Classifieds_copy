import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useState } from 'react';


const ApiTest = () => {
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const testApi = async () => {
    setLoading(true);
    setResult('Testing...');
    
    try {
      console.log('Testing API URL:', API_URL);
      console.log('Environment variables:', {
        REACT_APP_API_URL: process.env.REACT_APP_API_URL,
        REACT_APP_SUPABASE_URL: process.env.REACT_APP_SUPABASE_URL,
        REACT_APP_SUPABASE_KEY: process.env.REACT_APP_SUPABASE_KEY ? 'Set' : 'Not set'
      });
      
      // Test 1: Root endpoint
      const rootResponse = await fetch(`${API_URL}/`);
      const rootText = await rootResponse.text();
      console.log('Root response:', rootText);
      
      // Test 2: Cars endpoint
      const carsResponse = await fetch(`${API_URL}/api/cars`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      const carsContentType = carsResponse.headers.get('content-type');
      console.log('Cars response content-type:', carsContentType);
      
      let carsData;
      if (carsContentType && carsContentType.includes('application/json')) {
        carsData = await carsResponse.json();
      } else {
        carsData = await carsResponse.text();
      }
      
      setResult(JSON.stringify({
        apiUrl: API_URL,
        rootEndpoint: {
          status: rootResponse.status,
          data: rootText.substring(0, 200)
        },
        carsEndpoint: {
          status: carsResponse.status,
          contentType: carsContentType,
          data: typeof carsData === 'string' ? carsData.substring(0, 200) : carsData
        }
      }, null, 2));
      
    } catch (error) {
      console.error('API Test Error:', error);
      setResult(`Error: ${error.message}\n\nStack: ${error.stack}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>API Connection Test</h2>
      <p><strong>API URL:</strong> {API_URL}</p>
      <button onClick={testApi} disabled={loading}>
        {loading ? 'Testing...' : 'Test API Connection'}
      </button>
      <pre style={{ 
        marginTop: '20px', 
        padding: '10px', 
        background: '#f5f5f5', 
        borderRadius: '4px',
        overflow: 'auto',
        maxHeight: '500px'
      }}>
        {result || 'Click the button to test API connection'}
      </pre>
    </div>
  );
};

export default ApiTest;
