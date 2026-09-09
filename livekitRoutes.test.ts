// @vitest-environment node
/**
 * `/api/livekit/token` branches on whether a room is a call or a stream: call
 * rooms require the requester to be a registered participant, stream rooms hand
 * a viewer a subscribe-capable token to anyone signed in.
 *
 * That branch used to be `body.roomType === 'call' ? 'call' : 'stream'`, i.e.
 * the requester picked which check applied to them. Call rooms are named
 * `call:<uuid>` (CallModal.createCallRoomName), and both parties exchange the
 * name over signalling, so anyone who learned one could ask for a token
 * *without* the roomType field, take the stream branch, and get
 * `canSubscribe: true` on somebody else's private call.
 */
import { describe, expect, it } from 'vitest';
import { resolveRoomKind } from './livekitRoutes';

/** Stands in for callRooms' registry of rooms the signalling server created. */
const registered = (...names: string[]) => (roomName: string) => names.includes(roomName);
const none = () => false;

describe('resolveRoomKind', () => {
  it('treats a registered call room as a call however the request labels it', () => {
    const isKnown = registered('call:abc');

    expect(resolveRoomKind('call:abc', 'call', isKnown)).toBe('call');
    // The bypass: omitting roomType, or claiming 'stream', used to skip the
    // participant check entirely.
    expect(resolveRoomKind('call:abc', undefined, isKnown)).toBe('call');
    expect(resolveRoomKind('call:abc', 'stream', isKnown)).toBe('call');
  });

  it('still treats an unregistered call: name as a call, so it fails closed', () => {
    // No registration means isCallRoomParticipant() refuses everyone, which is
    // the safe outcome. Falling back to 'stream' here would mint a viewer token.
    expect(resolveRoomKind('call:not-registered', 'stream', none)).toBe('call');
    expect(resolveRoomKind('call:not-registered', undefined, none)).toBe('call');
  });

  it('keeps stream rooms on the stream branch', () => {
    expect(resolveRoomKind('stream:s1', undefined, none)).toBe('stream');
    // A stream room cannot be talked into the call branch either, which would
    // otherwise deny the host a publish token.
    expect(resolveRoomKind('stream:s1', 'call', none)).toBe('stream');
  });

  it('falls back to the requested type only for names with neither prefix', () => {
    expect(resolveRoomKind('lobby', 'call', none)).toBe('call');
    expect(resolveRoomKind('lobby', 'stream', none)).toBe('stream');
    expect(resolveRoomKind('lobby', undefined, none)).toBe('stream');
  });

  it('prefers the registry over the name, so an odd call room name still binds', () => {
    // call:initiate registers whatever roomName the caller sent, so a room can
    // be a real call without the prefix.
    expect(resolveRoomKind('lobby', 'stream', registered('lobby'))).toBe('call');
  });
});
