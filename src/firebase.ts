/**
 * Legacy export surface preserved for migration.
 *
 * The app historically imported `auth`, `db`, `storage`, `googleProvider` and
 * error helpers from this module. After the Supabase migration, these exports
 * are backed by the Supabase client + the Firestore-compat shim
 * (see src/supabase-shim/*). The Vite config aliases `firebase/*` imports
 * across the rest of the codebase to the same shim so component files keep
 * compiling.
 */

import { getAuth, GoogleAuthProvider, type FirebaseUser } from './supabase-shim/auth';
import { getFirestore, doc, getDoc, collection, query, getDocs, limit, where, orderBy, onSnapshot, addDoc, updateDoc, writeBatch, increment, serverTimestamp, Timestamp } from './supabase-shim/firestore';
import { getStorage } from './supabase-shim/storage';
import { supabase } from './supabase';

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export const googleProvider = new GoogleAuthProvider();
export { collection, query, getDocs, limit, where, orderBy, onSnapshot, addDoc, updateDoc, writeBatch, increment, serverTimestamp, Timestamp, doc, getDoc };
export { supabase };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMessage = error instanceof Error ? error.message : String(error);
  const isPermissionError =
    errMessage.toLowerCase().includes('permission') ||
    errMessage.toLowerCase().includes('insufficient') ||
    errMessage.toLowerCase().includes('row-level security');

  const current = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: current?.uid,
      email: current?.email,
      emailVerified: current?.emailVerified,
      isAnonymous: current?.isAnonymous,
      tenantId: current?.tenantId,
      providerInfo: current?.providerData.map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL,
      })) || [],
    },
    operationType,
    path,
  };

  const userFriendlyMessage = isPermissionError
    ? 'Neural Link Access Denied: Your current authorization level is insufficient for this operation.'
    : 'Neural Link Error: A disruption occurred in the data transmission. Please retry synchronization.';

  console.error('Supabase Error: ', JSON.stringify(errInfo));

  throw new Error(`${userFriendlyMessage} | DATA: ${JSON.stringify(errInfo)}`);
}

async function testConnection() {
  try {
    await getDoc(doc(db, 'users', '__connection_probe__'));
  } catch (error) {
    if (error instanceof Error && /offline|network/i.test(error.message)) {
      console.error('Please check your Supabase configuration (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
    }
  }
}
void testConnection();

export type { FirebaseUser };
