import React, { createContext, useContext, useState, useEffect } from 'react';
import { socket } from './lib/socket';
import { getValidSession } from './lib/authSession';
import { useAuth } from './AuthContext';
import { User } from './types';
import { CallModal } from './components/CallModal';
import { notifyIncomingCall, clearIncomingCallNotification } from './lib/notifications';

interface CallContextType {
  incomingCall: any | null;
  outgoingCall: { targetUser: User; videoEnabled: boolean } | null;
  initiateCall: (targetUser: User, videoEnabled?: boolean) => void;
  rejectCall: () => void;
  endCall: () => void;
  clearCall: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used within a CallProvider');
  return context;
};

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [outgoingCall, setOutgoingCall] = useState<{ targetUser: User; videoEnabled: boolean } | null>(null);

  const currentUserId = currentUser?.id;

  // Keyed on the user id, not the profile object: any realtime update to the
  // user's row (CRED, online flag, ...) produced a new object, and re-running
  // this effect disconnected the socket in the middle of a call.
  useEffect(() => {
    if (!currentUserId) return;

    // Connect and register user with socket server. The server derives the
    // identity from this token rather than from the id, so call signalling cannot
    // be redirected by claiming someone else's id.
    let cancelled = false;
    const register = () => {
      void getValidSession()
        .then((session) => {
          if (!cancelled) socket.emit('user:register', currentUserId, session.access_token);
        })
        .catch((err) => console.error('[CallContext] socket registration failed:', err));
    };

    // Server-side registration is keyed by socket id, so a dropped transport has
    // to re-register or incoming calls stop arriving after a reconnect.
    socket.on('connect', register);
    socket.connect();
    if (socket.connected) register();

    const handleIncomingCall = (data: any) => {
      setIncomingCall(data);
      // Show browser push notification (works even when app is in background)
      notifyIncomingCall(
        data.callerName || 'Unknown',
        data.callerAvatar,
        data.callerId
      );
    };
    const handleRejected = () => setOutgoingCall(null);
    const handleEnded = () => {
      setIncomingCall(null);
      setOutgoingCall(null);
      clearIncomingCallNotification();
    };

    socket.on('call:incoming', handleIncomingCall);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);

    return () => {
      cancelled = true;
      socket.off('connect', register);
      // Removing by handler reference: a bare socket.off('call:accepted') also
      // dropped CallModal's listeners for the same events.
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
      socket.disconnect();
    };
  }, [currentUserId]);

  const initiateCall = (targetUser: User, videoEnabled: boolean = true) => {
    setOutgoingCall({ targetUser, videoEnabled });
  };

  const rejectCall = () => {
    if (incomingCall) {
      socket.emit('call:reject', { callerId: incomingCall.callerId });
      setIncomingCall(null);
    }
    clearIncomingCallNotification();
  };

  const endCall = () => {
    setIncomingCall(null);
    setOutgoingCall(null);
    clearIncomingCallNotification();
  };

  const clearCall = () => {
    setIncomingCall(null);
    setOutgoingCall(null);
    clearIncomingCallNotification();
  };

  return (
    <CallContext.Provider value={{ 
      incomingCall, 
      outgoingCall, 
      initiateCall, 
      rejectCall, 
      endCall,
      clearCall
    }}>
      {children}
      
      {/* Global Call UI */}
      <CallModal 
        isOpen={!!outgoingCall || !!incomingCall}
        onClose={clearCall}
        isIncoming={!!incomingCall}
        incomingData={incomingCall}
        targetUserId={outgoingCall?.targetUser.id}
        targetUserName={outgoingCall?.targetUser.display_name}
        targetUserAvatar={outgoingCall?.targetUser.avatar_url}
        videoEnabled={incomingCall?.videoEnabled ?? outgoingCall?.videoEnabled ?? true}
      />
    </CallContext.Provider>
  );
};
