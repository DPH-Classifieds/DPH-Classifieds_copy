import { supabase } from './supabaseClient';

export async function getAuthenticatedHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.access_token) {
    return null;
  }
  return { Authorization: `Bearer ${data.session.access_token}` };
}
