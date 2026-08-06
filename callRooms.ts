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
}

/** Test seam. */
export function callRoomCount(): number {
  prune();
  return callRooms.size;
}
