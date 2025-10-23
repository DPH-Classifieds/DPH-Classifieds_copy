/**
 * Token debugging utility
 * Use this to diagnose token issues
 */

export const debugToken = () => {
  console.group('🔍 Token Debug Info');
  
  // Check authData
  const authData = localStorage.getItem('authData');
  if (authData) {
    try {
      const parsed = JSON.parse(authData);
      console.log('✅ authData exists:', {
        hasAccessToken: !!parsed.access_token,
        hasRefreshToken: !!parsed.refresh_token,
        hasUser: !!parsed.user,
        tokenPreview: parsed.access_token ? parsed.access_token.substring(0, 20) + '...' : 'none'
      });
    } catch (e) {
      console.error('❌ authData parse error:', e);
    }
  } else {
    console.log('❌ No authData in localStorage');
  }
  
  // Check supabase_access_token
  const supabaseToken = localStorage.getItem('supabase_access_token');
  if (supabaseToken) {
    console.log('✅ supabase_access_token exists:', {
      tokenPreview: supabaseToken.substring(0, 20) + '...',
      length: supabaseToken.length
    });
  } else {
    console.log('❌ No supabase_access_token in localStorage');
  }
  
  // Check axios headers
  const axios = require('axios');
  const authHeader = axios.defaults.headers.common['Authorization'];
  if (authHeader) {
    console.log('✅ Axios Authorization header set:', authHeader.substring(0, 30) + '...');
  } else {
    console.log('❌ No Authorization header in axios defaults');
  }
  
  console.groupEnd();
};

// Make it available globally for debugging
if (typeof window !== 'undefined') {
  window.debugToken = debugToken;
}
