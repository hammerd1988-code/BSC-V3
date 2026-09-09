/**
 * Who is allowed into a LiveKit call room.
 *
 * `/api/livekit/token` used to mint a publish-capable token for any room name a
 * signed-in caller asked for, as long as it looked like a call room. The names
 * were `call:<callerId>-<calleeId>-<Date.now() in base36>` — both ids are public
 * and the nonce is a timestamp — so a third party could guess a room and join a
 * private voice or video call.
 *
 * The signalling server is the only thing that knows who a call is between, so it
 * records the pair here when the call is placed and the token route checks it.
 * Process-local on purpose: call signalling, live streams and the relay
 * directives are already in memory, so the deployment is single-instance.
 */

/** Long enough for a ringing call plus the conversation; the room dies with it. */
const CALL_ROOM_TTL_MS = 6 * 60 * 60 * 1000;

interface CallRoom {
  participants: Set<string>;
  expiresAt: number;
}

const callRooms = new Map<string, CallRoom>();

function prune(now = Date.now()): void {
  for (const [roomName, room] of callRooms) {
    if (room.expiresAt <= now) callRooms.delete(roomName);
  }
}

/** Records the two accounts a call is between. Re-registering extends the TTL. */
export function registerCallRoom(roomName: string, participantIds: string[]): void {
  prune();
  const existing = callRooms.get(roomName);
  const participants = existing?.participants ?? new Set<string>();
  for (const id of participantIds) {
    if (id) participants.add(String(id));
  }
  callRooms.set(roomName, { participants, expiresAt: Date.now() + CALL_ROOM_TTL_MS });
}

/**
 * Whether `userId` may join `roomName`.
 *
 * An unknown room is refused: rooms are only created by `call:initiate`, so the
 * alternative is trusting the name again. A room whose registration was lost to a
 * restart is unreachable, but so is the socket connection the call ran over.
 */
export function isCallRoomParticipant(roomName: string, userId: string): boolean {
  prune();
  return callRooms.get(roomName)?.participants.has(String(userId)) ?? false;
}

export function releaseCallRoom(roomName: string): void {
  callRooms.delete(roomName);
}

/**
 * Who is in a call with whom, independent of the LiveKit room name.
 *
 * `call:initiate` derives the caller from the socket's verified session, but the
 * events that follow it — accept, reject, ICE, filter, end — took the peer id
 * straight from the payload. Any connected socket could therefore answer someone
 * else's call with its own SDP, feed ICE candidates into a conversation it was
 * not part of, or hang up a stranger's call. Recording the pair when the call is
 * placed gives those handlers something to check.
 */
const callPeers = new Map<string, Map<string, number>>();

function prunePeers(now = Date.now()): void {
  for (const [userId, peers] of callPeers) {
    for (const [peerId, expiresAt] of peers) {
      if (expiresAt <= now) peers.delete(peerId);
    }
    if (peers.size === 0) callPeers.delete(userId);
  }
}

function link(from: string, to: string, expiresAt: number): void {
  const peers = callPeers.get(from) ?? new Map<string, number>();
  peers.set(to, expiresAt);
  callPeers.set(from, peers);
}

/** Records that these two accounts are in (or ringing) a call together. */
export function registerCallPeers(a: string, b: string): void {
  prunePeers();
  if (!a || !b || a === b) return;
  const expiresAt = Date.now() + CALL_ROOM_TTL_MS;
  link(String(a), String(b), expiresAt);
  link(String(b), String(a), expiresAt);
}

export function areCallPeers(a: string, b: string): boolean {
  prunePeers();
  if (!a || !b) return false;
  return callPeers.get(String(a))?.has(String(b)) ?? false;
}

export function releaseCallPeers(a: string, b: string): void {
  callPeers.get(String(a))?.delete(String(b));
  callPeers.get(String(b))?.delete(String(a));
  prunePeers();
  callSignallingSockets.delete(signallingKey(a, b));
  callSignallingSockets.delete(signallingKey(b, a));
}

/**
 * Which socket each side of a call is signalling over.
 *
 * A user's account can hold several live sockets at once — one per browser tab
 * or device — but exactly one of them is in any given call. `call:incoming`,
 * `call:rejected` and `call:ended` are safe to fan out to all of them (they only
 * raise or clear the ringing UI), but `call:accepted`, `call:ice-candidate` and
 * `call:filter` are not: `CallModal` registers its listeners whether or not that
 * tab has a call open, so a broadcast `call:accepted` would make an uninvolved
 * tab of the same account join the LiveKit room and start publishing.
 *
 * So the socket that placed the call, and the socket that answered it, are
 * recorded here and those three events are delivered to that socket alone.
 */
const callSignallingSockets = new Map<string, { socketId: string; expiresAt: number }>();

function signallingKey(userId: string, peerId: string): string {
  return `${String(userId)}\u0000${String(peerId)}`;
}

function pruneSignallingSockets(now = Date.now()): void {
  for (const [key, entry] of callSignallingSockets) {
    if (entry.expiresAt <= now) callSignallingSockets.delete(key);
  }
}

/** Records that `userId` is signalling its call with `peerId` over `socketId`. */
export function registerCallSignallingSocket(userId: string, peerId: string, socketId: string): void {
  pruneSignallingSockets();
  if (!userId || !peerId || !socketId) return;
  callSignallingSockets.set(signallingKey(userId, peerId), {
    socketId: String(socketId),
    expiresAt: Date.now() + CALL_ROOM_TTL_MS,
  });
}

/** The socket `userId` is signalling its call with `peerId` over, if recorded. */
export function callSignallingSocket(userId: string, peerId: string): string | undefined {
  pruneSignallingSockets();
  return callSignallingSockets.get(signallingKey(userId, peerId))?.socketId;
}

/** Drops a disconnected socket so a stale id is never used as a target. */
export function forgetCallSignallingSocket(socketId: string): void {
  for (const [key, entry] of callSignallingSockets) {
    if (entry.socketId === socketId) callSignallingSockets.delete(key);
  }
}

/** Test seam. */
export function callRoomCount(): number {
  prune();
  return callRooms.size;
}
