import React, { createContext, useContext, useState, useEffect } from 'react';
import { socket } from './lib/socket';
import { useAuth } from './AuthContext';
import { User } from './types';
import { CallModal } from './components/CallModal';

interface CallContextType {
  incomingCall: any | null;
  outgoingCall: { targetUser: User } | null;
  initiateCall: (targetUser: User) => void;
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
  const [outgoingCall, setOutgoingCall] = useState<{ targetUser: User } | null>(null);
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (currentUserId) {
      const registerUser = () => socket.emit('user:register', currentUserId);
      const handleIncomingCall = (data: any) => setIncomingCall(data);
      const handleCallRejected = () => setOutgoingCall(null);
      const handleCallEnded = () => {
        setIncomingCall(null);
        setOutgoingCall(null);
      };
      const handleConnectError = (err: Error) => {
        console.warn('[socket] connection error:', err.message);
      };

      // Connect and register user with socket server
      socket.connect();
      if (socket.connected) registerUser();

      socket.on('connect', registerUser);
      socket.on('connect_error', handleConnectError);
      socket.on('call:incoming', handleIncomingCall);
      socket.on('call:rejected', handleCallRejected);
      socket.on('call:ended', handleCallEnded);

      return () => {
        socket.off('connect', registerUser);
        socket.off('connect_error', handleConnectError);
        socket.off('call:incoming', handleIncomingCall);
        socket.off('call:rejected', handleCallRejected);
        socket.off('call:ended', handleCallEnded);
        socket.disconnect();
      };
    }
  }, [currentUserId]);

  const initiateCall = (targetUser: User) => {
    setOutgoingCall({ targetUser });
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
      />
    </CallContext.Provider>
  );
};
