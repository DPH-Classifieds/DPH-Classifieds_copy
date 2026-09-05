import { getAuthenticatedHeaders } from './authenticatedApi';
import { supabase } from './supabaseClient';

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: jest.fn() } }),
}));

beforeEach(() => {
  jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { access_token: 'session-token' } },
  });
});

afterEach(() => jest.restoreAllMocks());

test('returns a bearer header for the active Supabase session', async () => {
  await expect(getAuthenticatedHeaders()).resolves.toEqual({
    Authorization: 'Bearer session-token',
  });
});

test('returns null when there is no active Supabase session', async () => {
  supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });

  await expect(getAuthenticatedHeaders()).resolves.toBeNull();
});
