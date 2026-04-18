/**
 * Firebase firestore → Supabase shim.
 *
 * Implements the subset of the Firestore JS SDK surface actually imported by
 * this project. Non-Supabase semantics (multi-collection atomic transactions,
 * composite-index validation, etc.) are approximated with best-effort
 * PostgREST/Realtime equivalents.
 *
 * When a behavior diverges from Firestore, the divergence is called out inline.
 */

import { supabase, tableFor, toDb, fromDb, mapFieldName } from '../supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ------------------------------------------------------------------
// Firestore-shaped value wrappers
// ------------------------------------------------------------------

export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  static now() {
    const ms = Date.now();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromDate(d: Date) {
    const ms = d.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromMillis(ms: number) {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  isEqual(other: Timestamp) { return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds; }
}

// Sentinels that are replaced at write time.
interface Sentinel { __sentinel: string; payload?: any; }

export function serverTimestamp(): Sentinel { return { __sentinel: 'serverTimestamp' }; }
export function increment(n: number): Sentinel { return { __sentinel: 'increment', payload: n }; }
export function arrayUnion(...vals: any[]): Sentinel { return { __sentinel: 'arrayUnion', payload: vals }; }
export function arrayRemove(...vals: any[]): Sentinel { return { __sentinel: 'arrayRemove', payload: vals }; }
export function deleteField(): Sentinel { return { __sentinel: 'delete' }; }

function isSentinel(v: any): v is Sentinel { return v && typeof v === 'object' && typeof v.__sentinel === 'string'; }

// ------------------------------------------------------------------
// Reference types
// ------------------------------------------------------------------

export interface Firestore { _marker: 'firestore'; }

const dbSingleton: Firestore = { _marker: 'firestore' };
export function getFirestore(_app?: unknown, _databaseId?: string): Firestore { return dbSingleton; }

export interface DocumentReference<T = any> {
  __kind: 'doc';
  table: string;
  id: string;
  path: string;
  parent: CollectionReference<T>;
}

type WhereFilter = { field: string; op: string; value: any };
type OrderByClause = { field: string; dir: 'asc' | 'desc' };

export interface Query<T = any> {
  __kind: 'query';
  table: string;
  wheres: WhereFilter[];
  orders: OrderByClause[];
  limit?: number;
  parentFilter?: { field: string; value: string };
}

function isDoc(v: any): v is DocumentReference { return v && v.__kind === 'doc'; }
function isColl(v: any): v is CollectionReference { return v && v.__kind === 'collection'; }
function isQuery(v: any): v is Query { return v && (v.__kind === 'query' || v.__kind === 'collection'); }

// ------------------------------------------------------------------
// Building refs: doc(db, 'users', uid) / doc(collRef, 'id') / collection(db, 'posts')
// ------------------------------------------------------------------

// Subcollection parent filter: when a collection is nested under a document,
// we inject a WHERE clause on the parent's FK column automatically.
// e.g. collection(db, 'posts', postId, 'comments') → comments WHERE post_id = postId
const SUBCOLLECTION_FK: Record<string, string> = {
  comments: 'post_id',
  transmits: 'transmission_id',
  stream_chat: 'stream_id',
  messages: 'stream_id',
};

export interface CollectionReference<T = any> {
  __kind: 'collection';
  table: string;
  name: string;
  path: string;
  parentFilter?: { field: string; value: string }; // injected for subcollections
}

export function collection(db: Firestore | DocumentReference, name: string, ...rest: string[]): CollectionReference {
  let table: string;
  let path: string;
  let parentFilter: { field: string; value: string } | undefined;

  if (isDoc(db)) {
    // collection(docRef, 'comments') — parent doc is db
    table = tableFor(name);
    path = `${db.path}/${name}`;
    const fk = SUBCOLLECTION_FK[table];
    if (fk) parentFilter = { field: fk, value: db.id };
  } else if (rest.length >= 2) {
    // collection(db, 'posts', postId, 'comments') — rest = [parentId, subcollName] or [parentId, sub, subId, sub2]
    // Find the last string that is a known table name
    const parentId = rest[0];
    const sub = rest[rest.length - 1];
    table = tableFor(sub);
    path = [name, ...rest].join('/');
    const fk = SUBCOLLECTION_FK[table];
    if (fk && parentId) parentFilter = { field: fk, value: parentId };
  } else {
    table = tableFor(name);
    path = name;
  }
  return { __kind: 'collection', table, name, path, parentFilter };
}

export function doc(dbOrColl: Firestore | CollectionReference, ...segments: string[]): DocumentReference {
  let table: string;
  let id: string;
  let path: string;
  if (isColl(dbOrColl)) {
    id = segments[0];
    table = dbOrColl.table;
    path = `${dbOrColl.path}/${id}`;
  } else {
    // doc(db, 'users', uid) OR doc(db, 'transmissions', txId, 'transmits', msgId)
    if (segments.length < 2) throw new Error('doc() requires (db, collection, id[, subcollection, subId])');
    const lastCollection = segments.length >= 4 ? segments[segments.length - 2] : segments[0];
    table = tableFor(lastCollection);
    id = segments[segments.length - 1];
    path = segments.join('/');
  }
  const parent: CollectionReference = { __kind: 'collection', table, name: table, path: path.split('/').slice(0, -1).join('/') };
  return { __kind: 'doc', table, id, path, parent };
}

// ------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------

export function query<T = any>(base: CollectionReference<T> | Query<T>, ...constraints: any[]): Query<T> {
  const out: Query<T> = {
    __kind: 'query',
    table: (base as any).table,
    wheres: isQuery(base) && 'wheres' in base ? [...base.wheres] : [],
    orders: isQuery(base) && 'orders' in base ? [...base.orders] : [],
    limit: isQuery(base) && 'limit' in base ? base.limit : undefined,
    parentFilter: (base as any).parentFilter,
  };
  for (const c of constraints) {
    if (!c) continue;
    if (c.__where) out.wheres.push(c.__where);
    else if (c.__orderBy) out.orders.push(c.__orderBy);
    else if (c.__limit !== undefined) out.limit = c.__limit;
  }
  return out;
}

export function where(field: string, op: string, value: any) {
  return { __where: { field, op, value } };
}

export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
  return { __orderBy: { field, dir } };
}

export function limit(n: number) {
  return { __limit: n };
}

function applyConstraints(builder: any, q: Query) {
  // Apply subcollection parent filter first (e.g. post_id = '...' for comments)
  if (q.parentFilter) {
    builder = builder.eq(q.parentFilter.field, q.parentFilter.value);
  }
  for (const w of q.wheres) {
    const f = mapFieldName(w.field);
    switch (w.op) {
      case '==': builder = builder.eq(f, w.value); break;
      case '!=': builder = builder.neq(f, w.value); break;
      case '<':  builder = builder.lt(f, w.value); break;
      case '<=': builder = builder.lte(f, w.value); break;
      case '>':  builder = builder.gt(f, w.value); break;
      case '>=': builder = builder.gte(f, w.value); break;
      case 'in': builder = builder.in(f, w.value); break;
      case 'not-in': builder = builder.not(f, 'in', `(${(w.value as any[]).map(v => typeof v === 'string' ? `"${v}"` : v).join(',')})`); break;
      case 'array-contains': builder = builder.contains(f, [w.value]); break;
      case 'array-contains-any': builder = builder.overlaps(f, w.value); break;
      default: throw new Error(`Unsupported where op: ${w.op}`);
    }
  }
  for (const o of q.orders) {
    builder = builder.order(mapFieldName(o.field), { ascending: o.dir === 'asc' });
  }
  if (q.limit) builder = builder.limit(q.limit);
  return builder;
}

// ------------------------------------------------------------------
// Snapshot shapes
// ------------------------------------------------------------------

export interface DocumentSnapshot<T = any> {
  id: string;
  exists(): boolean;
  data(): T | undefined;
  ref: DocumentReference<T>;
  get(field: string): any;
}

export interface QueryDocumentSnapshot<T = any> extends DocumentSnapshot<T> {
  data(): T;
}

export interface QuerySnapshot<T = any> {
  empty: boolean;
  size: number;
  docs: QueryDocumentSnapshot<T>[];
  forEach(cb: (d: QueryDocumentSnapshot<T>) => void): void;
}

function makeDocSnap<T>(ref: DocumentReference<T>, row: any | null): DocumentSnapshot<T> {
  // Keep both snake_case and camelCase keys during migration.
  const data = row ? { ...row, ...fromDb(row) } : undefined;
  return {
    id: ref.id,
    ref,
    exists: () => !!row,
    data: () => data as T | undefined,
    get: (f: string) => data?.[f],
  };
}

function makeQuerySnap<T>(rows: any[], table: string): QuerySnapshot<T> {
  const docs: QueryDocumentSnapshot<T>[] = rows.map((row) => {
    const ref = doc({ __kind: 'collection', table, name: table, path: table } as any, row.id);
    // Keep both snake_case and camelCase keys during migration.
    const data = { ...row, ...fromDb(row) };
    return {
      id: row.id,
      ref,
      exists: () => true,
      data: () => data as T,
      get: (f: string) => (data as any)?.[f],
    };
  });
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (cb) => docs.forEach(cb),
  };
}

// ------------------------------------------------------------------
// Reads
// ------------------------------------------------------------------

export async function getDoc<T = any>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const { data, error } = await supabase.from(ref.table).select('*').eq('id', ref.id).maybeSingle();
  if (error) throw error;
  return makeDocSnap<T>(ref, data);
}

export const getDocFromServer = getDoc;
export const getDocFromCache = getDoc;

export async function getDocs<T = any>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  const table = (q as any).table as string;
  let builder: any = supabase.from(table).select('*');
  // applyConstraints handles both parentFilter (subcollection) and where/orderBy/limit
  builder = applyConstraints(builder, q as Query);
  const { data, error } = await builder;
  if (error) throw error;
  return makeQuerySnap<T>(data ?? [], table);
}

// ------------------------------------------------------------------
// Writes
// ------------------------------------------------------------------

function resolveSentinels(patch: Record<string, any>, table: string, id: string): { row: Record<string, any>, followups: Array<() => Promise<any>> } {
  const row: Record<string, any> = {};
  const followups: Array<() => Promise<any>> = [];
  for (const [k, v] of Object.entries(patch)) {
    if (isSentinel(v)) {
      switch (v.__sentinel) {
        case 'serverTimestamp':
          row[k] = new Date().toISOString();
          break;
        case 'increment':
          followups.push(async () => {
            const field = mapFieldName(k);
            const { error } = await supabase.rpc('apply_increments', {
              p_table: table, p_id: id, p_delta: { [field]: v.payload },
            });
            if (error) throw error;
          });
          break;
        case 'arrayUnion':
          followups.push(async () => {
            const field = mapFieldName(k);
            const { data, error } = await supabase.from(table).select(field).eq('id', id).maybeSingle();
            if (error) throw error;
            const cur: any[] = (data as any)?.[field] ?? [];
            const next = Array.from(new Set([...cur, ...v.payload]));
            await supabase.from(table).update({ [field]: next }).eq('id', id);
          });
          break;
        case 'arrayRemove':
          followups.push(async () => {
            const field = mapFieldName(k);
            const { data, error } = await supabase.from(table).select(field).eq('id', id).maybeSingle();
            if (error) throw error;
            const cur: any[] = (data as any)?.[field] ?? [];
            const next = cur.filter((x) => !v.payload.includes(x));
            await supabase.from(table).update({ [field]: next }).eq('id', id);
          });
          break;
        case 'delete':
          row[k] = null;
          break;
      }
    } else {
      row[k] = v;
    }
  }
  return { row, followups };
}

export async function setDoc(ref: DocumentReference, data: any, options?: { merge?: boolean }) {
  const { row, followups } = resolveSentinels(data, ref.table, ref.id);
  const payload = { id: ref.id, ...toDb(row) };
  const builder = options?.merge
    ? supabase.from(ref.table).upsert(payload, { onConflict: 'id' })
    : supabase.from(ref.table).upsert(payload, { onConflict: 'id' });
  const { error } = await builder;
  if (error) throw error;
  for (const fn of followups) await fn();
}

export async function updateDoc(ref: DocumentReference, data: any) {
  const { row, followups } = resolveSentinels(data, ref.table, ref.id);
  if (Object.keys(row).length) {
    const { error } = await supabase.from(ref.table).update(toDb(row)).eq('id', ref.id);
    if (error) throw error;
  }
  for (const fn of followups) await fn();
}

export async function addDoc(ref: CollectionReference, data: any): Promise<DocumentReference> {
  const tempId = cryptoRandomId();
  const { row, followups } = resolveSentinels(data, ref.table, tempId);
  const payload = toDb(row);
  if (!payload.id) payload.id = tempId;
  // Inject parent FK for subcollections (e.g. post_id for comments)
  if (ref.parentFilter && !payload[ref.parentFilter.field]) {
    payload[ref.parentFilter.field] = ref.parentFilter.value;
  }
  const { data: inserted, error } = await supabase.from(ref.table).insert(payload).select('*').single();
  if (error) throw error;
  const ins = inserted as any;
  for (const fn of followups) await fn();
  return { __kind: 'doc', table: ref.table, id: ins.id, path: `${ref.path}/${ins.id}`, parent: ref };
}

export async function deleteDoc(ref: DocumentReference) {
  const { error } = await supabase.from(ref.table).delete().eq('id', ref.id);
  if (error) throw error;
}

// ------------------------------------------------------------------
// writeBatch — sequential, NOT atomic. Matches the existing call sites'
// tolerance (they use it for independent counter/flag updates).
// ------------------------------------------------------------------

interface BatchOp { kind: 'set' | 'update' | 'delete'; ref: DocumentReference; data?: any; merge?: boolean; }

export function writeBatch(_db: Firestore) {
  const ops: BatchOp[] = [];
  return {
    set(ref: DocumentReference, data: any, options?: { merge?: boolean }) { ops.push({ kind: 'set', ref, data, merge: options?.merge }); return this; },
    update(ref: DocumentReference, data: any) { ops.push({ kind: 'update', ref, data }); return this; },
    delete(ref: DocumentReference) { ops.push({ kind: 'delete', ref }); return this; },
    async commit() {
      for (const op of ops) {
        if (op.kind === 'set') await setDoc(op.ref, op.data, { merge: op.merge });
        else if (op.kind === 'update') await updateDoc(op.ref, op.data);
        else await deleteDoc(op.ref);
      }
    },
  };
}

// ------------------------------------------------------------------
// Realtime: onSnapshot
// ------------------------------------------------------------------

type Unsub = () => void;

export function onSnapshot<T = any>(
  target: DocumentReference<T> | Query<T> | CollectionReference<T>,
  onNext: (snap: any) => void,
  onError?: (err: Error) => void,
): Unsub {
  if (isDoc(target)) return onDocSnapshot(target, onNext, onError);
  return onQuerySnapshot(target as Query<T>, onNext, onError);
}

function onDocSnapshot<T>(
  ref: DocumentReference<T>,
  cb: (snap: DocumentSnapshot<T>) => void,
  onError?: (err: Error) => void,
): Unsub {
  let cancelled = false;
  const emit = async () => {
    try {
      const snap = await getDoc(ref);
      if (!cancelled) cb(snap);
    } catch (e) {
      onError?.(e as Error);
    }
  };
  void emit();
  const channel: RealtimeChannel = supabase
    .channel(`doc:${ref.table}:${ref.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: ref.table, filter: `id=eq.${ref.id}` }, () => { void emit(); })
    .subscribe();
  return () => { cancelled = true; void supabase.removeChannel(channel); };
}

function onQuerySnapshot<T>(
  q: Query<T> | CollectionReference<T>,
  cb: (snap: QuerySnapshot<T>) => void,
  onError?: (err: Error) => void,
): Unsub {
  const table = (q as any).table as string;
  const parentFilter = (q as any).parentFilter as { field: string; value: string } | undefined;
  let cancelled = false;
  const emit = async () => {
    try {
      const snap = await getDocs(q as Query<T>);
      if (!cancelled) cb(snap);
    } catch (e) {
      onError?.(e as Error);
    }
  };
  void emit();
  // For subcollections, filter realtime events by the parent's FK value
  const filter = parentFilter ? `${parentFilter.field}=eq.${parentFilter.value}` : undefined;
  const channel: RealtimeChannel = supabase
    .channel(`coll:${table}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter } as any, () => { void emit(); })
    .subscribe();
  return () => { cancelled = true; void supabase.removeChannel(channel); };
}

// ------------------------------------------------------------------
// utilities
// ------------------------------------------------------------------

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as any).randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
