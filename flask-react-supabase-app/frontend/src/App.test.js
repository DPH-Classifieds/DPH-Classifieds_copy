import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('axios', () => {
  const mockAxios = {
    create: () => mockAxios,
    get: jest.fn(() => Promise.resolve({ status: 200, data: [] })),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    }
  };

  return mockAxios;
});

jest.mock('@vercel/analytics/react', () => ({
  Analytics: () => null
}), { virtual: true });

jest.mock('@vercel/speed-insights/react', () => ({
  SpeedInsights: () => null
}), { virtual: true });

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } }
      })),
      signOut: jest.fn()
    },
    from: jest.fn(() => ({
      select: jest.fn().mockResolvedValue({ data: [], error: null })
    }))
  })
}), { virtual: true });

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: () => null,
  useMap: () => ({})
}), { virtual: true });

jest.mock('leaflet', () => ({
  icon: jest.fn(),
  Marker: { prototype: { options: {} } }
}), { virtual: true });

jest.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }) => <div>{children}</div>,
  useAuth: () => ({ user: null, isLoading: false, signOut: jest.fn() })
}));

test('renders site header', () => {
  render(<App />);
  const headerElement = screen.getByRole('link', { name: /DPHClassifieds/i });
  expect(headerElement).toBeInTheDocument();
});
