// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { callRoomCount, isCallRoomParticipant, registerCallRoom, releaseCallRoom } from './callRooms';

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
