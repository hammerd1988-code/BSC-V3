// Minimal stub of firebase/app. The real work is done by the Supabase client.
// Returned object is only consumed by our own shims (getAuth, getFirestore, getStorage).
export function initializeApp(_config: unknown) {
  return { name: 'supabase-shim' };
}
export function getApp() {
  return { name: 'supabase-shim' };
}
