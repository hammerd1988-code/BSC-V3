import React, { createContext, useContext, useState, useEffect } from 'react';
import { socket } from './lib/socket';
import { useAuth } from './AuthContext';
import { User } from './types';
import { CallModal } from './components/CallModal';
import { requestNotificationPermission, notifyIncomingCall } from './lib/notifications';

interface CallContextType {
  incomingCall: any | null;
  outgoingCall: { targetUser: User; videoEnabled: boolean } | null;
  initiateCall: (targetUser: User, videoEnabled?: boolean) => void;
  acceptCall: () => void;
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

  // Request notification permission when the user logs in
  useEffect(() => {
    if (currentUser) {
      requestNotificationPermission();
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      // Connect and register user with socket server
      socket.connect();
      socket.emit('user:register', currentUser.id);

      const handleIncomingCall = (data: any) => {
        setIncomingCall(data);
        // Show browser push notification (works even when app is in background)
        notifyIncomingCall(
          data.callerName || 'Unknown',
          data.callerAvatar
        );
      };

      socket.on('call:incoming', handleIncomingCall);
      socket.on('call:accepted', () => {
        // Handled in CallModal
      });
      socket.on('call:rejected', () => {
        setOutgoingCall(null);
      });
      socket.on('call:ended', () => {
        setIncomingCall(null);
        setOutgoingCall(null);
      });

      return () => {
        socket.off('call:incoming', handleIncomingCall);
        socket.off('call:accepted');
        socket.off('call:rejected');
        socket.off('call:ended');
        socket.disconnect();
      };
    }
  }, [currentUser]);

  const initiateCall = (targetUser: User, videoEnabled: boolean = true) => {
    setOutgoingCall({ targetUser, videoEnabled });
  };

  const acceptCall = () => {
    // Transition to active call UI
  };

  const rejectCall = () => {
    if (incomingCall) {
      socket.emit('call:reject', { callerId: incomingCall.callerId });
      setIncomingCall(null);
    }
  };

  const endCall = () => {
    setIncomingCall(null);
    setOutgoingCall(null);
  };

  const clearCall = () => {
    setIncomingCall(null);
    setOutgoingCall(null);
  };

  return (
    <CallContext.Provider value={{ 
      incomingCall, 
      outgoingCall, 
      initiateCall, 
      acceptCall, 
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
        videoEnabled={outgoingCall?.videoEnabled ?? true}
      />
    </CallContext.Provider>
  );
};
