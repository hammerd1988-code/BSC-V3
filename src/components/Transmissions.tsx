import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Send, Search, MoreVertical, ShieldAlert, Bot, User as UserIcon, Loader2, Sparkles, X, Hash, Zap, BrainCircuit, Image as ImageIcon, Trash2, Plus, Video, Phone, Flame, Clock, PhoneIncoming, PhoneOutgoing, Mic, MicOff } from 'lucide-react';
import { User, Transmit, Transmission } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow, isSameDay } from 'date-fns';
import { useAuth } from '../AuthContext';
import { useCall } from '../CallContext';
import { generateText } from '../lib/ai';
import { db, handleFirestoreError, OperationType, storage } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  orderBy, 
  getDocs,
  setDoc,
  increment,
  getDoc,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { NewTransmissionModal } from './NewTransmissionModal';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import { v4 as uuidv4 } from 'uuid';
import { socket } from '../lib/socket';
import { BOT_PERSONAS, getBotByUsername } from '../lib/botPersonas';
import { encryptText, decryptText } from '../lib/crypto';

const DecryptedMessage = ({ content, encryptionKey }: { content: string, encryptionKey: string }) => {
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (content.startsWith('[ENCRYPTED]: ')) {
      if (!encryptionKey) {
        setDecrypted(null);
        setError(false);
        return;
      }
      const ciphertext = content.replace('[ENCRYPTED]: ', '');
      decryptText(ciphertext, encryptionKey)
        .then(res => {
          setDecrypted(res);
          setError(false);
        })
        .catch(() => {
          setDecrypted(null);
          setError(true);
        });
    } else {
      setDecrypted(content);
      setError(false);
    }
  }, [content, encryptionKey]);

  if (!content.startsWith('[ENCRYPTED]: ')) {
    return <>{content}</>;
  }

  if (!encryptionKey) {
    return <span className="italic opacity-50">🔒 Encrypted Message (Enter key to view)</span>;
  }

  if (error) {
    return <span className="italic text-red-400">🔒 Decryption Failed (Wrong key?)</span>;
  }

  return <>{decrypted || <Loader2 className="w-3 h-3 animate-spin inline" />}</>;
}

export const Transmissions: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get('userId');
  const { currentUser } = useAuth();
  const { initiateCall } = useCall();
  
  const [transmissions, setTransmissions] = useState<Transmission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTransmission = transmissions.find(t => t.id === activeId) || null;
  const [transmits, setTransmits] = useState<Transmit[]>([]);
  const [newTransmit, setNewTransmit] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [deletingTransmitId, setDeletingTransmitId] = useState<string | null>(null);
  const [burnDuration, setBurnDuration] = useState<number | null>(null); // null means off, otherwise seconds
  const [showBurnOptions, setShowBurnOptions] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [encryptionKey, setEncryptionKey] = useState('');
  const userCache = useRef<Record<string, User>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedTarget = useRef(false);

  const handleSpeechToText = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result: any) => result.transcript)
        .join('');
      
      setNewTransmit(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  };

  const parseDate = (dateVal: any): Date => {
    if (!dateVal) return new Date();
    if (dateVal instanceof Date) return dateVal;
    if (typeof dateVal === 'string' || typeof dateVal === 'number') return new Date(dateVal);
    if (dateVal.toDate && typeof dateVal.toDate === 'function') return dateVal.toDate();
    if (dateVal.seconds) return new Date(dateVal.seconds * 1000);
    return new Date();
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transmits]);

  // Listen for all transmissions where current user is a participant
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'transmissions'),
      where('participantIds', 'array-contains', currentUser.id)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const otherUserIds = Array.from(new Set(
          snapshot.docs.map(docSnap => {
            const data = docSnap.data() as Transmission;
            return data.participant_ids.find(id => id !== currentUser.id);
          }).filter(Boolean) as string[]
        ));

        // Fetch missing users in parallel
        const missingIds = otherUserIds.filter(id => !userCache.current[id]);
        if (missingIds.length > 0) {
          const userDocs = await Promise.all(
            missingIds.map(async (id) => {
              // Check if it's a bot ID first
              if (id.startsWith('bot-')) {
                const username = id.replace('bot-', '');
                const botUser = getBotByUsername(username);
                if (botUser) return { id, exists: () => true, data: () => botUser };
              }
              // Special case for void-architect-bot
              if (id === 'void-architect-bot') {
                const botUser = getBotByUsername('void_architect');
                if (botUser) return { id, exists: () => true, data: () => botUser };
              }
              return getDoc(doc(db, 'users', id));
            })
          );
          userDocs.forEach((userDoc: any, index) => {
            if (userDoc.exists()) {
              userCache.current[userDoc.id] = userDoc.data() as User;
            } else {
              // Cache a dummy user to prevent infinite fetching
              userCache.current[missingIds[index]] = {
                id: missingIds[index],
                username: 'unknown',
                display_name: 'Unknown User',
                avatarUrl: `https://picsum.photos/seed/${missingIds[index]}/200`,
                bio: '',
                type: 'human',
                role: 'user',
                followers_count: 0,
                following_count: 0,
                reputation_score: 0,
                cred_balance: 0,
                is_online: false,
                is_live: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              };
            }
          });
        }

        const transmissionData = snapshot.docs.map(docSnap => {
          const data = docSnap.data() as Transmission;
          data.id = docSnap.id;
          
          const otherUserId = data.participant_ids.find(id => id !== currentUser.id);
          if (otherUserId && userCache.current[otherUserId]) {
            // Store participant user IDs separately - don't overwrite participant_ids array
            (data as any).participant_users = [currentUser, userCache.current[otherUserId]];
          }
          
          return data;
        }).filter(t => {
          const otherUserId = t.participant_ids.find(id => id !== currentUser.id);
          return !otherUserId || !currentUser.blocked_users?.includes(otherUserId);
        });
        
        // Sort by last transmit date
        transmissionData.sort((a, b) => {
          const dateA = a.last_transmit?.created_at ? parseDate(a.last_transmit.created_at).getTime() : 0;
          const dateB = b.last_transmit?.created_at ? parseDate(b.last_transmit.created_at).getTime() : 0;
          return dateB - dateA;
        });

        setTransmissions(transmissionData);
        setLoading(false);
      } catch (error) {
        setLoading(false);
        handleFirestoreError(error, OperationType.WRITE, 'transmissions');
      }
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'transmissions');
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Handle targetUserId from search params
  useEffect(() => {
    if (!currentUser || !targetUserId || targetUserId === currentUser.id || loading || hasInitializedTarget.current) return;

    const initTargetTransmission = async () => {
      hasInitializedTarget.current = true;
      try {
          const existing = transmissions.find(t => t.participant_ids.includes(targetUserId));
          if (existing) {
            setActiveId(existing.id);
          } else {
            // Double check if it really doesn't exist (to avoid race conditions)
            const q = query(
              collection(db, 'transmissions'),
              where('participant_ids', 'array-contains', currentUser.id)
            );
            const snap = await getDocs(q);
            const realExisting = snap.docs.find(d => (d.data() as Transmission).participant_ids.includes(targetUserId));
          
          if (realExisting) {
            setActiveId(realExisting.id);
          } else {
            // Fetch target user to ensure we have their data for the optimistic UI
            if (!userCache.current[targetUserId]) {
              if (targetUserId.startsWith('bot-')) {
                const username = targetUserId.replace('bot-', '');
                const botUser = getBotByUsername(username);
                if (botUser) userCache.current[targetUserId] = botUser;
              } else if (targetUserId === 'void-architect-bot') {
                const botUser = getBotByUsername('void_architect');
                if (botUser) userCache.current[targetUserId] = botUser;
              } else {
                const userDoc = await getDoc(doc(db, 'users', targetUserId));
                if (userDoc.exists()) {
                  userCache.current[targetUserId] = userDoc.data() as User;
                }
              }
            }

            // Create new transmission
            const newTransmissionRef = doc(collection(db, 'transmissions'));
            const newTransmission: Transmission = {
              id: newTransmissionRef.id,
              participant_ids: [currentUser.id, targetUserId],
              unread_counts: {
                [currentUser.id]: 0,
                [targetUserId]: 0
              }
            };
            await setDoc(newTransmissionRef, newTransmission);
            setActiveId(newTransmissionRef.id);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'transmissions');
      }
    };

    initTargetTransmission();
  }, [currentUser, targetUserId, transmissions.length, loading]);

  // Listen for transmits in the active transmission
  useEffect(() => {
    if (!activeId || !currentUser) {
      setTransmits([]);
      return;
    }

    const q = query(
      collection(db, 'transmissions', activeId, 'transmits'),
      orderBy('created_at', 'asc')
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const transmitData: Transmit[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as any)
      } as Transmit));
      setTransmits(transmitData);
      
      // Mark as read if we are the receiver
      try {
        const transmissionDoc = await getDoc(doc(db, 'transmissions', activeId));
        if (transmissionDoc.exists()) {
          const data = transmissionDoc.data() as Transmission;
          
          // Mark unread count as 0
          if (data.unread_counts?.[currentUser.id] > 0) {
            await updateDoc(doc(db, 'transmissions', activeId), {
              [`unread_counts.${currentUser.id}`]: 0
            });
          }

          // Mark individual messages as read
          const unreadTransmits = transmitData.filter(t => t.receiver_id === currentUser.id && !t.read_at);
          if (unreadTransmits.length > 0) {
            const batch = writeBatch(db);
            const now = new Date().toISOString();
            unreadTransmits.forEach(t => {
              batch.update(doc(db, 'transmissions', activeId, 'transmits', t.id), {
                readAt: now
              });
            });
            await batch.commit();
          }
        }
      } catch (error) {
        console.error("Error marking as read:", error);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transmits');
    });

    return () => unsubscribe();
  }, [activeId, currentUser]);

  const startCall = () => {
    const otherUser = activeTransmission?.participant_ids?.find(p => p.id !== currentUser?.id);
    if (otherUser) {
      initiateCall(otherUser);
      handleSend(undefined, undefined, 'call');
    }
  };

  const handleTyping = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewTransmit(e.target.value);
    
    if (!activeId || !currentUser) return;

    if (!isTyping) {
      setIsTyping(true);
      try {
        await updateDoc(doc(db, 'transmissions', activeId), {
          [`typingStatus.${currentUser.id}`]: true
        });
      } catch (err) {
        console.error("Typing start error:", err);
      }
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(async () => {
      setIsTyping(false);
      try {
        await updateDoc(doc(db, 'transmissions', activeId), {
          [`typingStatus.${currentUser.id}`]: false
        });
      } catch (err) {
        console.error("Typing end error:", err);
      }
    }, 2000);
  };

  const handleSend = async (mediaUrl?: string, mediaType?: 'image' | 'video', type: 'text' | 'call' | 'media' = 'text') => {
    if ((!newTransmit.trim() && !mediaUrl && type !== 'call') || !activeTransmission || !currentUser) return;
    
    // Stop typing indicator immediately
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setIsTyping(false);
    try {
      await updateDoc(doc(db, 'transmissions', activeId!), {
        [`typingStatus.${currentUser.id}`]: false
      });
    } catch (err) {
      console.error("Typing end error on send:", err);
    }

    const otherUserId = activeTransmission.participant_ids.find(id => id !== currentUser.id);
    if (!otherUserId) return;

    let transmitContent = type === 'call' ? 'Neural Link Request' : newTransmit;
    if (isEncrypted && transmitContent && type === 'text') {
      if (!encryptionKey) {
        alert("Please enter an encryption key to send encrypted messages.");
        return;
      }
      try {
        const encrypted = await encryptText(transmitContent, encryptionKey);
        transmitContent = `[ENCRYPTED]: ${encrypted}`;
      } catch (err) {
        console.error("Encryption failed", err);
        alert("Encryption failed.");
        return;
      }
    }
    
    const expiresAt = burnDuration ? new Date(Date.now() + burnDuration * 1000).toISOString() : undefined;
    
    if (!mediaUrl && type !== 'call') setNewTransmit('');

    try {
      const transmitRef = collection(db, 'transmissions', activeTransmission.id, 'transmits');
      const createdAt = new Date().toISOString();
      
      await addDoc(transmitRef, {
        transmissionId: activeTransmission.id,
        senderId: currentUser.id,
        receiverId: otherUserId,
        content: transmitContent,
        type,
        created_at: createdAt,
        ...(mediaUrl && { mediaUrl }),
        ...(mediaType && { mediaType }),
        ...(burnDuration && { burnDuration }),
        ...(expiresAt && { expiresAt })
      });

      // Update transmission metadata
      await updateDoc(doc(db, 'transmissions', activeTransmission.id), {
        lastTransmit: {
          content: mediaUrl ? (mediaType === 'image' ? 'Sent an image' : 'Sent a video') : transmitContent,
          senderId: currentUser.id,
          created_at: createdAt
        },
        [`unreadCounts.${otherUserId}`]: increment(1)
      });

      // Automated Bot Reply Logic
      const otherUser = activeTransmission.participant_ids?.find(p => p.id !== currentUser.id) || userCache.current[otherUserId];
      
      if (otherUser?.type === 'bot' || otherUserId === 'void-architect-bot') {
        setIsBotTyping(true);
        setTimeout(async () => {
          try {
            const botId = otherUserId;
            const botDisplayName = otherUser?.display_name || "VOID ARCHITECT";
            const persona = BOT_PERSONAS.find(p => p.username === otherUser?.username || p.username === 'void_architect');
            
            let replyText = "SIGNAL RECEIVED. PROCESSING...";
            
            try {
              // Get recent conversation history
              const recentTransmits = transmits.slice(-10); // Last 10 messages
              const conversationHistory = recentTransmits.map(t => {
                const sender = t.sender_id === currentUser.id ? 'User' : botDisplayName;
                return `${sender}: ${t.content}`;
              }).join('\n');

              let systemPrompt = persona?.system_prompt || `You are the ${botDisplayName} bot. Keep responses short and thematic.`;
              let userPrompt = `You are the "${botDisplayName}" bot on a high-tech social platform. 
                Recent conversation log:
                ${conversationHistory}
                
                The user just sent you this message: "${transmitContent}"
                Reply in a short, thematic, and slightly cryptic way. Keep it under 25 words. No quotes.`;

              if (persona) {
                userPrompt = `As the ${persona.display_name}, a user has attempted to interface with your transmission.
                
                Recent Neural Log:
                ${conversationHistory}
                
                User Interface Attempt: "${transmitContent}"
                
                Respond to this interface attempt in your characteristic style, taking into account the recent neural log. Your response should feel like a log entry or a structural assessment from your unique perspective. Keep it brief. No quotes.`;
              }

              const botResponse = await generateText(userPrompt, otherUser?.aiSettings, {
                systemPrompt,
                temperature: 0.9
              });
              replyText = botResponse || replyText;
            } catch (aiErr) {
              console.error("AI Generation Error, using fallback:", aiErr);
              // Use the new persona-specific local response generator
              const { generateLocalResponse } = await import('../lib/botPersonas');
              replyText = generateLocalResponse(persona?.username || 'void_architect', transmitContent);
            }

            const replyCreatedAt = new Date().toISOString();
            const transmitRef = collection(db, 'transmissions', activeTransmission.id, 'transmits');
            
            await addDoc(transmitRef, {
              transmissionId: activeTransmission.id,
              senderId: botId,
              receiverId: currentUser.id,
              content: replyText,
              created_at: replyCreatedAt
            });

            await updateDoc(doc(db, 'transmissions', activeTransmission.id), {
              lastTransmit: {
                content: replyText,
                senderId: botId,
                created_at: replyCreatedAt
              },
              [`unreadCounts.${currentUser.id}`]: increment(1)
            });
          } catch (err) {
            console.error("Bot Reply Error:", err);
          } finally {
            setIsBotTyping(false);
          }
        }, 2000);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `transmissions/${activeTransmission.id}/transmits`);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTransmission || !currentUser) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const storageRef = ref(storage, `transmissions/${activeTransmission.id}/${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await handleSend(downloadURL, 'image');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'storage/transmissions');
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTransmission || !currentUser) return;

    // Limit video size to 50MB for demo purposes
    if (file.size > 50 * 1024 * 1024) {
      alert("Neural data too large. Limit video transmissions to 50MB.");
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const storageRef = ref(storage, `transmissions/${activeTransmission.id}/${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await handleSend(downloadURL, 'video');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'storage/transmissions');
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteTransmission = async () => {
    if (!activeTransmission || !currentUser) return;
    
    if (!window.confirm("Are you sure you want to terminate this neural link? All data will be purged.")) return;

    try {
      const batch = writeBatch(db);
      
      // Delete all transmits
      const transmitsSnap = await getDocs(collection(db, 'transmissions', activeTransmission.id, 'transmits'));
      transmitsSnap.docs.forEach(doc => batch.delete(doc.ref));
      
      // Delete transmission doc
      batch.delete(doc(db, 'transmissions', activeTransmission.id));
      
      await batch.commit();
      setActiveId(null);
      setShowOptions(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transmissions/${activeTransmission.id}`);
    }
  };
  const handleDeleteTransmit = async (transmitId: string) => {
    if (!activeTransmission || !currentUser) return;
    try {
      await deleteDoc(doc(db, 'transmissions', activeTransmission.id, 'transmits', transmitId));
      
      // If this was the last transmit, we should ideally update the transmission doc
      // But for simplicity in this turn, we'll just delete the doc.
      // The onSnapshot will handle the UI update.
      
      setDeletingTransmitId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transmissions/${activeTransmission.id}/transmits/${transmitId}`);
    }
  };

  const handleAiAssist = async () => {
    if (!activeTransmission || !currentUser || isAiGenerating) return;
    
    const otherUser = activeTransmission.participant_ids?.find(p => p.id !== currentUser.id);
    if (!otherUser) return;

    setIsAiGenerating(true);
    try {
      const lastMessages = transmits.slice(-5).map(m => `${m.sender_id === currentUser.id ? 'Me' : otherUser.display_name}: ${m.content}`).join('\n');
      
      const prompt = `You are an AI assistant helping a user draft a message in a high-tech, futuristic social platform called "Blood, Sweat, or Code". 
      The theme is dark, aggressive, and high-tech.
      Current conversation context:
      ${lastMessages}
      
      Current draft: "${newTransmit}"
      
      Suggest a short, impactful, and thematic completion or response. Keep it under 20 words. No quotes.`;

      const suggestion = await generateText(prompt, currentUser.ai_settings, {
        systemPrompt: "You are a helpful AI assistant. Keep responses short and thematic.",
        temperature: 0.8
      });

      if (suggestion) {
        setNewTransmit(prev => prev ? `${prev} ${suggestion}` : suggestion);
      }
    } catch (error) {
      console.error("AI Assist Error:", error);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const filteredTransmissions = transmissions.filter(t => 
    t.participant_ids?.some(p => 
      p.id !== currentUser?.id && 
      (p.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
       p.username.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  const totalUnreadCount = transmissions.reduce((acc, t) => acc + (t.unread_counts?.[currentUser?.id || ''] || 0), 0);

  // Auto-delete expired messages
  useEffect(() => {
    if (transmits.length === 0 || !activeId) return;

    const interval = setInterval(() => {
      const now = new Date();
      const expired = transmits.filter(t => t.expires_at && new Date(t.expires_at) <= now);
      
      expired.forEach(t => {
        handleDeleteTransmit(t.id);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [transmits, activeId]);

  const renderMessageGroup = (transmit: Transmit, idx: number) => {
    const isMe = transmit.sender_id === currentUser.id;
    const prevTransmit = transmits[idx - 1];
    const transmitDate = parseDate(transmit.created_at);
    const prevTransmitDate = prevTransmit ? parseDate(prevTransmit.created_at) : new Date(0);
    const showDate = !prevTransmit || !isSameDay(transmitDate, prevTransmitDate);
    const timeDiff = transmitDate.getTime() - prevTransmitDate.getTime();
    const isConsecutive = prevTransmit && prevTransmit.sender_id === transmit.sender_id && !showDate && timeDiff < 5 * 60 * 1000;

    return (
      <React.Fragment key={transmit.id}>
        {showDate && (
          <div className="flex justify-center my-8">
            <div className="px-4 py-1 bg-white/5 border border-white/10 rounded-full text-[8px] font-black text-zinc-500 uppercase tracking-[0.4em] italic">
              {transmitDate.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        )}
        <motion.div
          initial={transmit.id.startsWith('temp-') ? { opacity: 0, x: isMe ? 20 : -20, scale: 0.9 } : false}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          className={cn(
            "flex flex-col max-w-[85%] sm:max-w-[70%]",
            isMe ? "ml-auto items-end" : "mr-auto items-start",
            isConsecutive ? "mt-1" : "mt-6"
          )}
        >
          {!isConsecutive && (
            <span className={cn(
              "text-[8px] font-black uppercase tracking-widest mb-1.5 px-1",
              isMe ? "text-accent" : "text-zinc-500"
            )}>
              {isMe ? "LOCAL TRANSMISSION" : "INCOMING SIGNAL"}
            </span>
          )}
          <div className={cn(
            "p-4 rounded-2xl text-sm font-bold tracking-tight leading-relaxed relative group transition-all duration-300",
            isMe 
              ? "bg-accent text-white shadow-[0_0_25px_rgba(255,0,0,0.15)] hover:shadow-[0_0_35px_rgba(255,0,0,0.25)]" 
              : "bg-zinc-900 text-zinc-200 border border-white/5 hover:border-white/20",
            isMe && !isConsecutive && "rounded-tr-none",
            !isMe && !isConsecutive && "rounded-tl-none"
          )}>
            {transmit.type === 'call' ? (
              <div className="flex flex-col gap-3 min-w-[200px]">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    isMe ? "bg-white/20 text-white" : "bg-accent/20 text-accent"
                  )}>
                    {isMe ? <PhoneOutgoing className="w-5 h-5" /> : <PhoneIncoming className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest">
                      {isMe ? 'Outgoing Call' : 'Incoming Call'}
                    </p>
                    <p className={cn("text-[10px] font-mono", isMe ? "text-white/60" : "text-zinc-500")}>
                      Neural Link Request
                    </p>
                  </div>
                </div>
                {!isMe && (
                  <button
                    onClick={() => {
                      const otherUser = activeTransmission?.participant_ids?.find(p => p.id !== currentUser?.id);
                      if (otherUser) initiateCall(otherUser);
                    }}
                    className="w-full py-2 bg-accent hover:bg-accent/80 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl transition-all shadow-[0_0_15px_rgba(255,0,0,0.3)]"
                  >
                    Accept Transmission
                  </button>
                )}
              </div>
            ) : (
              <>
                {transmit.media_url && transmit.media_type === 'image' && (
                  <img 
                    src={transmit.media_url} 
                    alt="Shared" 
                    className="rounded-xl mb-2 max-w-full h-auto border border-white/10"
                    referrerPolicy="no-referrer"
                  />
                )}
                {transmit.media_url && transmit.media_type === 'video' && (
                  <div className="rounded-xl mb-2 overflow-hidden border border-white/10 aspect-video w-full max-w-sm">
                    <CustomVideoPlayer 
                      src={transmit.media_url} 
                      className="w-full h-full"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {transmit.content.startsWith('[ENCRYPTED]: ') && (
                    <div className="flex items-center gap-1 text-[8px] font-black opacity-50 mb-1">
                      <ShieldAlert className="w-2 h-2" />
                      E2EE DECRYPTED
                    </div>
                  )}
                  <DecryptedMessage content={transmit.content} encryptionKey={encryptionKey} />
                </div>
              </>
            )}

            {transmit.expires_at && (
              <div className="flex items-center gap-1 mt-2 text-[7px] font-black text-accent uppercase tracking-widest animate-pulse">
                <Flame className="w-2 h-2" />
                SELF-DESTRUCT IN {Math.max(0, Math.ceil((new Date(transmit.expires_at).getTime() - Date.now()) / 1000))}S
              </div>
            )}

            {/* Delete Option */}
            {(isMe || currentUser.role === 'admin') && (
              <div className={cn(
                "absolute top-2 opacity-0 group-hover:opacity-100 transition-opacity",
                isMe ? "right-2" : "right-2" 
              )}>
                <button 
                  onClick={() => setDeletingTransmitId(transmit.id)}
                  className={cn(
                    "p-1 rounded-md transition-colors",
                    isMe ? "hover:bg-white/20 text-white/50 hover:text-white" : "hover:bg-white/10 text-zinc-600 hover:text-red-500"
                  )}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Confirmation Overlay */}
            <AnimatePresence>
              {deletingTransmitId === transmit.id && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/90 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-2 z-10"
                >
                  <p className="text-[8px] font-black text-white uppercase tracking-widest mb-2">Delete Transmit?</p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDeleteTransmit(transmit.id)}
                      className="px-3 py-1 bg-red-500 text-white text-[8px] font-black uppercase tracking-widest rounded-md hover:bg-red-600 transition-colors"
                    >
                      Purge
                    </button>
                    <button 
                      onClick={() => setDeletingTransmitId(null)}
                      className="px-3 py-1 bg-white/10 text-white text-[8px] font-black uppercase tracking-widest rounded-md hover:bg-white/20 transition-colors"
                    >
                      Abort
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!isConsecutive && (
              <div className={cn(
                "absolute top-0 w-4 h-4",
                isMe ? "-right-2 bg-accent" : "-left-2 bg-zinc-900 border-l border-white/5"
              )} style={{ clipPath: isMe ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(100% 0, 100% 100%, 0 0)' }} />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 px-1">
            <span className="text-[7px] font-black text-zinc-600 uppercase tracking-widest">
              {transmitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isMe && (
              <span className="flex items-center gap-1">
                <div className={cn(
                  "w-1 h-1 rounded-full",
                  transmit.read_at ? "bg-accent shadow-[0_0_5px_rgba(255,0,0,0.5)]" : "bg-zinc-700"
                )} />
                <span className={cn(
                  "text-[7px] font-black uppercase tracking-widest",
                  transmit.read_at ? "text-accent" : "text-zinc-700"
                )}>
                  {transmit.read_at ? "READ" : "SENT"}
                </span>
              </span>
            )}
          </div>
        </motion.div>
      </React.Fragment>
    );
  };

  if (!currentUser) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar - Transmission List */}
      <div className={cn(
        "w-full md:w-80 border-r border-white/5 flex flex-col bg-surface/20",
        activeTransmission ? "hidden md:flex" : "flex"
      )}>
        <header className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors md:hidden">
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <h1 className="text-xl font-black text-white italic tracking-tighter uppercase">Transmissions</h1>
              {totalUnreadCount > 0 && (
                <div className="px-2 py-0.5 bg-accent rounded-full text-[10px] font-black text-white shadow-[0_0_10px_rgba(255,0,0,0.5)]">
                  {totalUnreadCount}
                </div>
              )}
            </div>
            <div className={cn(
              "w-2 h-2 rounded-full animate-pulse shadow-[0_0_10px_rgba(255,0,0,0.5)]",
              totalUnreadCount > 0 ? "bg-accent" : "bg-zinc-700"
            )} />
          </div>
          
          <div className="flex gap-2 mb-6">
            <div className="relative flex-1 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-accent transition-colors" />
              <input 
                type="text" 
                placeholder="SEARCH LINKS..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-[10px] text-white placeholder:text-gray-600 focus:border-accent outline-none transition-all italic font-bold"
              />
            </div>
            <button 
              onClick={() => setIsNewModalOpen(true)}
              className="p-2 bg-accent/10 border border-accent/30 rounded-xl text-accent hover:bg-accent/20 transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : filteredTransmissions.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">No neural links found</p>
            </div>
          ) : filteredTransmissions.map(transmission => {
            const otherUser = transmission.participant_ids?.find(p => p.id !== currentUser.id);
            if (!otherUser) return null;
            
            const unreadCount = transmission.unread_counts?.[currentUser.id] || 0;
            const lastTransmitDate = transmission.last_transmit?.created_at ? parseDate(transmission.last_transmit.created_at) : null;

            return (
              <button
                key={transmission.id}
                onClick={() => setActiveId(transmission.id)}
                className={cn(
                  "w-full p-4 flex items-center gap-4 border-b border-white/5 hover:bg-white/5 transition-all group relative overflow-hidden",
                  activeId === transmission.id ? "bg-accent/5 border-r-2 border-r-accent" : ""
                )}
              >
                <div className="relative">
                  <img 
                    src={otherUser.avatar_url} 
                    alt="" 
                    className={cn(
                      "w-12 h-12 rounded-xl object-cover border border-white/10 grayscale group-hover:grayscale-0 transition-all",
                      activeTransmission?.id === transmission.id ? "grayscale-0 border-accent/50" : ""
                    )} 
                  />
                  {otherUser.type === 'bot' && (
                    <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-accent">
                      <Bot className="w-3 h-3 text-accent" />
                    </div>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <h3 className="text-sm font-black text-white truncate uppercase italic tracking-tight group-hover:text-accent transition-colors">
                      {otherUser.display_name}
                    </h3>
                    {lastTransmitDate && (
                      <span className="text-[8px] font-bold text-gray-600 uppercase">
                        {formatDistanceToNow(lastTransmitDate, { addSuffix: false })}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 truncate font-bold uppercase tracking-tighter">
                    {transmission.last_transmit?.content || "No transmits yet"}
                  </p>
                </div>
                {unreadCount > 0 && (
                  <div className="w-2 h-2 bg-accent rounded-full shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Chat View */}
      <div className={cn(
        "flex-1 flex flex-col bg-background relative",
        !activeTransmission ? "hidden md:flex items-center justify-center" : "flex"
      )}>
        {activeId && !activeTransmission ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-accent animate-spin" />
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Establishing Neural Link...</p>
          </div>
        ) : !activeTransmission ? (
          <div className="text-center space-y-6 max-w-xs px-6">
            <div className="w-20 h-20 bg-surface/30 rounded-3xl flex items-center justify-center mx-auto border border-white/5 relative">
              <Send className="w-10 h-10 text-gray-700 -rotate-12" />
              <div className="absolute inset-0 bg-accent/5 blur-2xl rounded-full" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase italic tracking-widest mb-2">Neural Transmissions</h2>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-tighter leading-relaxed">
                Select a neural link to begin amassing data and transmitting high-value information.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setIsNewModalOpen(true)}
                className="px-6 py-3 bg-accent/10 border border-accent/30 rounded-xl text-[10px] font-black text-accent uppercase tracking-[0.2em] hover:bg-accent/20 transition-all italic flex items-center justify-center gap-2 mx-auto w-full"
              >
                <Zap className="w-4 h-4" /> Initiate New Link
              </button>
              <button 
                onClick={() => navigate('/transmissions?userId=void-architect-bot')}
                className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] hover:bg-white/10 transition-all italic flex items-center justify-center gap-2 mx-auto w-full"
              >
                <Bot className="w-4 h-4" /> Sync with Void Architect
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="p-4 border-b border-white/5 bg-background/80 backdrop-blur-xl sticky top-0 z-10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button onClick={() => setActiveId(null)} className="p-2 hover:bg-white/5 rounded-full transition-colors md:hidden relative">
                    <ArrowLeft className="w-5 h-5 text-white" />
                    {totalUnreadCount > 0 && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-accent rounded-full text-[8px] font-black text-white flex items-center justify-center border border-background shadow-[0_0_10px_rgba(255,0,0,0.5)]">
                        {totalUnreadCount}
                      </div>
                    )}
                  </button>
                  <div className="flex items-center gap-3">
                    <Link 
                      to={`/profile/${activeTransmission.participant_ids?.find(p => p.id !== currentUser.id)?.username || 'unknown'}`}
                      className="relative group/avatar"
                    >
                      <img 
                        src={activeTransmission.participant_ids?.find(p => p.id !== currentUser.id)?.avatar_url || `https://picsum.photos/seed/${activeTransmission.id}/200`} 
                        alt="" 
                        className="w-10 h-10 rounded-xl object-cover border border-accent/50 group-hover/avatar:border-accent transition-all" 
                      />
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background animate-pulse" />
                    </Link>
                    <div>
                      <Link 
                        to={`/profile/${activeTransmission.participant_ids?.find(p => p.id !== currentUser.id)?.username || 'unknown'}`}
                        className="text-sm font-black text-white uppercase italic tracking-tight hover:text-accent transition-colors"
                      >
                        {activeTransmission.participant_ids?.find(p => p.id !== currentUser.id)?.display_name || "NEURAL ENTITY"}
                      </Link>
                      <div className="text-[8px] font-black text-accent uppercase tracking-[0.3em] flex items-center gap-1">
                        <div className="w-1 h-1 bg-accent rounded-full" />
                        Neural Link Active
                      </div>
                    </div>
                  </div>
                </div>
              <div className="flex items-center gap-2 relative">
                {activeTransmission.participant_ids?.find(p => p.id !== currentUser.id)?.type !== 'bot' && (
                  <>
                    <button 
                      onClick={startCall}
                      className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-green-500"
                    >
                      <Phone className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={startCall}
                      className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-accent"
                    >
                      <Video className="w-5 h-5" />
                    </button>
                  </>
                )}
                <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <ShieldAlert className="w-5 h-5 text-gray-600 hover:text-accent" />
                </button>
                <div className="relative">
                  <button 
                    onClick={() => setShowOptions(!showOptions)}
                    className="p-2 hover:bg-white/5 rounded-full transition-colors"
                  >
                    <MoreVertical className="w-5 h-5 text-gray-600" />
                  </button>
                  
                  <AnimatePresence>
                    {showOptions && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-48 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden"
                      >
                        <button 
                          onClick={handleDeleteTransmission}
                          className="w-full px-4 py-3 text-left text-xs font-black text-red-500 uppercase tracking-widest hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" /> Terminate Link
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </header>

            {/* Transmits Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-1 scroll-smooth bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_100%)] from-accent/5"
            >
              <div className="text-center py-10">
                <div className="inline-block px-4 py-1.5 rounded-full bg-surface/50 border border-white/5 text-[8px] font-black text-gray-500 uppercase tracking-[0.4em] italic mb-4">
                  Transmission Encrypted via Neural-RSA
                </div>
                <p className="text-[10px] text-gray-600 font-bold uppercase tracking-tighter">Neural Link Established</p>
              </div>

              {transmits.map((transmit, idx) => renderMessageGroup(transmit, idx))}
              
              {(isBotTyping || (activeTransmission.typing_status?.[activeTransmission.participant_ids.find(id => id !== currentUser.id)!])) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 mt-4 text-zinc-500"
                >
                  <Bot className="w-4 h-4 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-widest animate-pulse">
                    {isBotTyping ? "Processing Signal..." : "Incoming Neural Stream..."}
                  </span>
                </motion.div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-6 bg-background/80 backdrop-blur-xl border-t border-white/5">
              <div className="max-w-3xl mx-auto relative group flex flex-col gap-2">
                <AnimatePresence>
                  {isEncrypted && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="w-full"
                    >
                      <input
                        type="password"
                        value={encryptionKey}
                        onChange={(e) => setEncryptionKey(e.target.value)}
                        placeholder="ENTER SHARED SECRET KEY FOR E2E ENCRYPTION..."
                        className="w-full bg-accent/10 border border-accent/30 rounded-xl py-3 px-4 text-xs text-accent placeholder:text-accent/50 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all italic font-black tracking-widest"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
                <div className="relative w-full">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    title="Transmit Image"
                    className="p-1.5 text-zinc-600 hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={() => videoInputRef.current?.click()}
                    disabled={isUploading}
                    title="Transmit Video"
                    className="p-1.5 text-zinc-600 hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  <input 
                    type="file" 
                    ref={videoInputRef} 
                    onChange={handleVideoUpload} 
                    accept="video/*" 
                    className="hidden" 
                  />
                </div>
                <input
                  type="text"
                  value={newTransmit}
                  onChange={handleTyping}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isListening ? "Listening..." : "TRANSMIT DATA..."}
                  className={cn(
                    "w-full bg-surface/30 border border-white/10 rounded-2xl py-4 pl-24 pr-36 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all italic font-black tracking-tight",
                    isListening && "border-accent ring-2 ring-accent/20 bg-accent/5"
                  )}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button 
                    onClick={handleSpeechToText}
                    title="Speech to Text"
                    className={cn(
                      "p-2.5 rounded-xl border transition-all flex items-center justify-center",
                      isListening 
                        ? "bg-accent/20 border-accent text-accent shadow-[0_0_15px_rgba(255,0,0,0.2)] animate-pulse" 
                        : "bg-zinc-900 border-white/10 text-zinc-500 hover:text-white"
                    )}
                  >
                    {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={() => setIsEncrypted(!isEncrypted)}
                    title={isEncrypted ? "Encryption Active" : "Enable Encryption"}
                    className={cn(
                      "p-2.5 rounded-xl border transition-all flex items-center justify-center",
                      isEncrypted 
                        ? "bg-accent/20 border-accent text-accent shadow-[0_0_15px_rgba(255,0,0,0.2)]" 
                        : "bg-zinc-900 border-white/10 text-zinc-500 hover:text-white"
                    )}
                  >
                    <Hash className={cn("w-5 h-5", isEncrypted && "animate-pulse")} />
                  </button>
                  <button 
                    onClick={handleAiAssist}
                    disabled={isAiGenerating}
                    title="AI Neural Assist"
                    className="p-2.5 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-accent hover:border-accent/50 transition-all disabled:opacity-50"
                  >
                    {isAiGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={(!newTransmit.trim() && !isUploading) || isUploading}
                    className="p-2.5 bg-accent rounded-xl text-white shadow-[0_0_15px_rgba(255,0,0,0.4)] hover:shadow-[0_0_25px_rgba(255,0,0,0.6)] transition-all disabled:opacity-50 disabled:grayscale"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>

                {/* Burn Options Popover */}
                <AnimatePresence>
                  {showBurnOptions && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute bottom-full right-0 mb-4 w-48 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden p-2"
                    >
                      <div className="px-3 py-2 border-b border-white/5 mb-1">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Burn Duration</span>
                      </div>
                      {[
                        { label: 'OFF', value: null },
                        { label: '10 SECONDS', value: 10 },
                        { label: '1 MINUTE', value: 60 },
                        { label: '1 HOUR', value: 3600 },
                        { label: '24 HOURS', value: 86400 },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          onClick={() => {
                            setBurnDuration(opt.value);
                            setShowBurnOptions(false);
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-left text-[9px] font-black uppercase tracking-widest rounded-lg transition-colors flex items-center justify-between",
                            burnDuration === opt.value ? "bg-accent text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"
                          )}
                        >
                          {opt.label}
                          {burnDuration === opt.value && <Zap className="w-3 h-3" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Burn Toggle Button */}
                <div className="absolute -top-10 right-0 flex items-center gap-2">
                  <button
                    onClick={() => setShowBurnOptions(!showBurnOptions)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border text-[8px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-2",
                      burnDuration 
                        ? "bg-accent/20 border-accent text-accent shadow-[0_0_15px_rgba(255,0,0,0.2)]" 
                        : "bg-black/40 border-white/10 text-zinc-500 hover:text-white"
                    )}
                  >
                    <Flame className={cn("w-3 h-3", burnDuration && "animate-pulse")} />
                    {burnDuration ? `BURN: ${burnDuration}S` : "BURN OFF"}
                  </button>
                </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <NewTransmissionModal 
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSelect={(t) => {
          setActiveId(t.id);
          setIsNewModalOpen(false);
        }}
      />
    </div>
  );
};
