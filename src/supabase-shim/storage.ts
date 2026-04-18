import { supabase } from '../supabase';

const DEFAULT_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'media';

export interface Storage { _marker: 'storage'; }
const singleton: Storage = { _marker: 'storage' };

export function getStorage(): Storage { return singleton; }

export interface StorageReference {
  bucket: string;
  path: string;
  fullPath: string;
  name: string;
}

/**
 * ref(storage, 'avatars/uid.png')  OR  ref(storage, 'avatars', 'uid.png')
 * Firebase treats the first path segment as a folder; Supabase uses named
 * buckets. We route everything through VITE_SUPABASE_STORAGE_BUCKET by
 * default, preserving the original path as the object key inside that bucket.
 */
export function ref(_storage: Storage, ...parts: string[]): StorageReference {
  const path = parts.filter(Boolean).join('/');
  return {
    bucket: DEFAULT_BUCKET,
    path,
    fullPath: path,
    name: path.split('/').pop() ?? path,
  };
}

export async function uploadBytes(ref: StorageReference, data: Blob | ArrayBuffer | Uint8Array, metadata?: { contentType?: string }) {
  const { error } = await supabase.storage.from(ref.bucket).upload(ref.path, data as any, {
    upsert: true,
    contentType: metadata?.contentType,
  });
  if (error) throw error;
  return { ref, metadata: metadata ?? {} };
}

export async function uploadString(ref: StorageReference, value: string, format: 'raw' | 'data_url' | 'base64' | 'base64url' = 'raw', metadata?: { contentType?: string }) {
  let body: Blob;
  let contentType = metadata?.contentType;
  if (format === 'data_url') {
    const match = value.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) throw new Error('Invalid data URL');
    contentType ??= match[1];
    const bin = atob(match[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = new Blob([bytes], { type: contentType });
  } else if (format === 'base64' || format === 'base64url') {
    const normalized = format === 'base64url' ? value.replace(/-/g, '+').replace(/_/g, '/') : value;
    const bin = atob(normalized);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = new Blob([bytes], { type: contentType });
  } else {
    body = new Blob([value], { type: contentType });
  }
  const { error } = await supabase.storage.from(ref.bucket).upload(ref.path, body, { upsert: true, contentType });
  if (error) throw error;
  return { ref, metadata: metadata ?? {} };
}

export async function getDownloadURL(ref: StorageReference): Promise<string> {
  const { data } = supabase.storage.from(ref.bucket).getPublicUrl(ref.path);
  return data.publicUrl;
}

export async function deleteObject(ref: StorageReference): Promise<void> {
  const { error } = await supabase.storage.from(ref.bucket).remove([ref.path]);
  if (error) throw error;
}
