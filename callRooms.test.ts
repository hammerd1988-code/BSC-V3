// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  areCallPeers,
  callRoomCount,
  isCallRoomParticipant,
  registerCallPeers,
  registerCallRoom,
  releaseCallPeers,
  releaseCallRoom,
} from './callRooms';

describe('call room membership', () => {
  beforeEach(() => {
    releaseCallRoom('call:one');
    releaseCallRoom('call:two');
  });

  it('admits only the pair the call was placed between', () => {
    registerCallRoom('call:one', ['caller-1', 'callee-1']);

    expect(isCallRoomParticipant('call:one', 'caller-1')).toBe(true);
    expect(isCallRoomParticipant('call:one', 'callee-1')).toBe(true);
    expect(isCallRoomParticipant('call:one', 'eavesdropper')).toBe(false);
  });

  it('refuses a room nobody registered', () => {
    // The old behaviour: any signed-in user could mint a publish token for a
    // room name they guessed, because the name was all that was checked.
    expect(isCallRoomParticipant('call:never-registered', 'caller-1')).toBe(false);
  });

  it('forgets a room once the call ends', () => {
    registerCallRoom('call:two', ['caller-2', 'callee-2']);
    expect(callRoomCount()).toBeGreaterThan(0);

    releaseCallRoom('call:two');
    expect(isCallRoomParticipant('call:two', 'caller-2')).toBe(false);
  });

  it('ignores blank participant ids', () => {
    registerCallRoom('call:one', ['caller-1', '']);
    expect(isCallRoomParticipant('call:one', '')).toBe(false);
  });
});

/**
 * The signalling events after `call:initiate` took the peer id from the payload,
 * so any connected socket could answer, hang up or feed ICE candidates into a
 * call it was not part of. These are what the handlers now check.
 */
describe('call peers', () => {
  beforeEach(() => {
    releaseCallPeers('caller', 'callee');
    releaseCallPeers('caller', 'stranger');
    releaseCallPeers('callee', 'stranger');
  });

  it('pairs both directions when a call is placed', () => {
    registerCallPeers('caller', 'callee');
    expect(areCallPeers('caller', 'callee')).toBe(true);
    expect(areCallPeers('callee', 'caller')).toBe(true);
  });

  it('keeps a third party out of somebody else\'s call', () => {
    registerCallPeers('caller', 'callee');
    expect(areCallPeers('stranger', 'caller')).toBe(false);
    expect(areCallPeers('stranger', 'callee')).toBe(false);
  });

  it('knows nothing about a pair that never called', () => {
    expect(areCallPeers('caller', 'callee')).toBe(false);
  });

  it('forgets the pair once the call ends', () => {
    registerCallPeers('caller', 'callee');
    releaseCallPeers('caller', 'callee');
    expect(areCallPeers('caller', 'callee')).toBe(false);
  });

  it('ignores blank and self-directed pairs', () => {
    registerCallPeers('caller', '');
    registerCallPeers('caller', 'caller');
    expect(areCallPeers('caller', '')).toBe(false);
    expect(areCallPeers('caller', 'caller')).toBe(false);
  });
});
