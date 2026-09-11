// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  areCallPeers,
  callRoomCount,
  callSignallingSocket,
  forgetCallSignallingSocket,
  isCallRoomParticipant,
  registerCallPeers,
  registerCallRoom,
  registerCallSignallingSocket,
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

/**
 * An account can hold several live sockets at once — one per tab or device — but
 * only one of them is in any given call. `call:accepted`, `call:ice-candidate`
 * and `call:filter` must reach that socket alone: CallModal registers its
 * listeners whether or not the tab has a call open, and its `call:accepted`
 * handler joins the LiveKit room, so a fan-out would pull an uninvolved tab of
 * the same account into the call as a publisher.
 */
describe('call signalling sockets', () => {
  beforeEach(() => {
    releaseCallPeers('caller', 'callee');
    forgetCallSignallingSocket('socket-caller-tab-a');
    forgetCallSignallingSocket('socket-caller-tab-b');
    forgetCallSignallingSocket('socket-callee-tab-a');
  });

  it('routes the answer back to the tab that placed the call', () => {
    registerCallSignallingSocket('caller', 'callee', 'socket-caller-tab-a');
    expect(callSignallingSocket('caller', 'callee')).toBe('socket-caller-tab-a');
  });

  it('keeps the two directions of one call apart', () => {
    registerCallSignallingSocket('caller', 'callee', 'socket-caller-tab-a');
    registerCallSignallingSocket('callee', 'caller', 'socket-callee-tab-a');

    expect(callSignallingSocket('caller', 'callee')).toBe('socket-caller-tab-a');
    expect(callSignallingSocket('callee', 'caller')).toBe('socket-callee-tab-a');
  });

  it('does not confuse a second tab of the same account with the one in the call', () => {
    // Opening another tab used to overwrite the account's only socket entry, so
    // the answer went to whichever tab had registered most recently.
    registerCallSignallingSocket('caller', 'callee', 'socket-caller-tab-a');
    expect(callSignallingSocket('caller', 'callee')).toBe('socket-caller-tab-a');

    // A second tab registering for a *different* peer must not move this call.
    registerCallSignallingSocket('caller', 'someone-else', 'socket-caller-tab-b');
    expect(callSignallingSocket('caller', 'callee')).toBe('socket-caller-tab-a');
  });

  it('knows nothing about a pair that never signalled', () => {
    expect(callSignallingSocket('caller', 'callee')).toBeUndefined();
  });

  it('drops a disconnected socket rather than keeping a stale target', () => {
    registerCallSignallingSocket('caller', 'callee', 'socket-caller-tab-a');
    forgetCallSignallingSocket('socket-caller-tab-a');
    expect(callSignallingSocket('caller', 'callee')).toBeUndefined();
  });

  it('forgets both directions when the call is released', () => {
    registerCallSignallingSocket('caller', 'callee', 'socket-caller-tab-a');
    registerCallSignallingSocket('callee', 'caller', 'socket-callee-tab-a');

    releaseCallPeers('caller', 'callee');

    expect(callSignallingSocket('caller', 'callee')).toBeUndefined();
    expect(callSignallingSocket('callee', 'caller')).toBeUndefined();
  });

  it('ignores incomplete registrations', () => {
    registerCallSignallingSocket('caller', 'callee', '');
    expect(callSignallingSocket('caller', 'callee')).toBeUndefined();
    registerCallSignallingSocket('', 'callee', 'socket-caller-tab-a');
    expect(callSignallingSocket('', 'callee')).toBeUndefined();
  });
});
