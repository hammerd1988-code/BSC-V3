import React, { createContext, useContext, useState, useEffect } from 'react';
import { socket } from './lib/socket';
import { useAuth } from './AuthContext';
import { User } from './types';

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

  useEffect(() => {
    if (currentUser) {
      const handleIncomingCall = (data: any) => {
        setIncomingCall(data);
      };

      socket.on('call:incoming', handleIncomingCall);
      socket.on('call:accepted', () => {
        // Handle transition to active call if needed
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
      };
    }
  }, [currentUser]);

  const initiateCall = (targetUser: User) => {
    setOutgoingCall({ targetUser });
  };

  const acceptCall = () => {
    // Logic handled in CallModal but we can track state here
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
    </CallContext.Provider>
  );
};
