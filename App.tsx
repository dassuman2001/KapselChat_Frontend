import React, { useState, useEffect, useRef } from 'react';
import { Auth } from './components/Auth';
import { NewChatModal } from './components/NewChatModal';
import { conversationApi, messageApi, userApi } from './services/api';
import { socketService } from './services/socket'; // The new global file
import { encryptMessage, decryptMessage } from './services/crypto';
import { 
  User, 
  Conversation, 
  Message 
} from './types';
import { 
  AUTH_TOKEN_KEY, 
  LOGGED_IN_USER_KEY, 
  USER_CACHE_KEY,
  ACTIVE_CONVERSATION_KEY
} from './constants';
import { 
  MessageSquare, 
  LogOut, 
  Plus, 
  Send, 
  Lock,
  ArrowLeft,
  Paperclip,
  Camera
} from 'lucide-react';
import { format } from 'date-fns';
import { Button } from './components/Button';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  });
  
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [inputText, setInputText] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(true); 
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track processed message IDs to prevent duplicates
  const processedMessageIds = useRef<Set<string>>(new Set());
  const isLoadingHistory = useRef<Set<string>>(new Set());

  // ------------------------------------------------------------
  // 4. Initialize ONCE in App.tsx
  // ------------------------------------------------------------
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const storedUser = localStorage.getItem(LOGGED_IN_USER_KEY);
    
    if (token && storedUser) {
      const user = JSON.parse(storedUser);
      setCurrentUser(user);

      // 4a. Call socket.init(token)
      socketService.init(token);

      // 4b. Attach ONE subscription listener
      socketService.subscribeUserQueue(async (msg: Message) => {
        console.log('⚡ Socket Received:', msg.id);

        // Deduplication check
        if (processedMessageIds.current.has(msg.id)) {
           return;
        }
        processedMessageIds.current.add(msg.id);

        // Decrypt immediately
        let decryptedText = 'Decryption Failed';
        try {
          decryptedText = await decryptMessage(msg.ciphertext, msg.iv);
        } catch (e) {
          console.error("Failed to decrypt realtime message:", e);
        }
        const processedMessage = { ...msg, text: decryptedText };

        // 5. State update fix: Use structuredClone / Immutable copy
        setMessages((prev) => {
          // Deep copy the previous state
          const copy = structuredClone(prev);

          // Ensure array exists
          if (!copy[msg.conversationId]) {
            copy[msg.conversationId] = [];
          }

          // Check for duplicate in array (double safety)
          const exists = copy[msg.conversationId].some((m: Message) => m.id === msg.id);
          if (!exists) {
            // Add new message
            copy[msg.conversationId].push(processedMessage);
            
            // Sort
            copy[msg.conversationId].sort((a: Message, b: Message) => 
               new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          }
          
          return copy;
        });
      });
    }

    // 8. Never re-subscribe or deactivate on unmount of App unless strictly logging out
    // We intentionally leave the cleanup empty for the socket persistence during hot-reloads 
    // or navigation, unless the user explicitly Logs Out.
  }, []); // Empty dependency array []

  // Persist Active Conversation
  useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
    } else {
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
  }, [activeConversationId]);

  // Load message history when conversation becomes active
  useEffect(() => {
    if (!activeConversationId || !currentUser) return;

    const loadHistory = async () => {
      if (isLoadingHistory.current.has(activeConversationId)) {
        return;
      }
      
      // If we already have messages, don't fetch (realtime will handle new ones)
      if (messages[activeConversationId]?.length > 0) {
        return;
      }

      isLoadingHistory.current.add(activeConversationId);
      
      try {
        const history = await messageApi.getForConversation(activeConversationId);
        
        const decryptedHistory = await Promise.all(history.map(async (m) => {
          processedMessageIds.current.add(m.id);
          let text = 'Decryption Failed';
          try {
            text = await decryptMessage(m.ciphertext, m.iv);
          } catch (e) { /* ignore */ }
          return { ...m, text };
        }));
        
        setMessages(prev => {
          const copy = structuredClone(prev);
          copy[activeConversationId] = decryptedHistory.sort((a: Message, b: Message) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
          return copy;
        });
        
      } catch (err) {
        console.error("Failed to load history:", err);
      } finally {
        isLoadingHistory.current.delete(activeConversationId);
      }
    };

    loadHistory();
  }, [activeConversationId, currentUser]);

  // Fetch Conversations
  const fetchConversations = async () => {
    if (!currentUser) return;
    try {
      const convs = await conversationApi.getAll();
      const cacheStr = localStorage.getItem(USER_CACHE_KEY);
      const cache = cacheStr ? JSON.parse(cacheStr) : {};
      const missingUserIds = new Set<string>();
      
      let resolvedConvs = convs.map(c => {
        const otherId = c.participantIds.find(id => id !== currentUser.id);
        const otherUser = otherId ? cache[otherId] : undefined;
        if (otherId && !otherUser) missingUserIds.add(otherId);
        return { ...c, otherUser };
      });
      
      setConversations(resolvedConvs);

      if (missingUserIds.size > 0) {
        const fetchedUsers = await Promise.all(
          Array.from(missingUserIds).map(id => userApi.getUser(id).catch(() => null))
        );
        let cacheUpdated = false;
        fetchedUsers.forEach(u => {
          if (u) {
            cache[u.id] = u;
            cacheUpdated = true;
          }
        });

        if (cacheUpdated) {
          localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cache));
          // Re-map with new cache
          setConversations(prev => prev.map(c => {
            const otherId = c.participantIds.find(id => id !== currentUser?.id);
            return { ...c, otherUser: cache[otherId!] || c.otherUser };
          }));
        }
      }
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    }
  };

  useEffect(() => {
    if (currentUser) fetchConversations();
  }, [currentUser]);

  const handleSelectConversation = (convId: string) => {
    setActiveConversationId(convId);
    setIsMobileMenuOpen(false);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversationId || !currentUser || !inputText.trim()) return;

    const textToSend = inputText.trim();
    setInputText('');

    // Temporary ID for optimistic UI
    const tempId = `temp-${Date.now()}`;

    try {
      const { ciphertext, iv } = await encryptMessage(textToSend);

      const optimisticMsg: Message = {
        id: tempId,
        conversationId: activeConversationId,
        senderId: currentUser.id,
        ciphertext,
        iv,
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        readAt: null,
        text: textToSend,
        isSending: true
      };

      // Optimistic update using structuredClone
      setMessages(prev => {
        const copy = structuredClone(prev);
        if (!copy[activeConversationId]) copy[activeConversationId] = [];
        copy[activeConversationId].push(optimisticMsg);
        return copy;
      });

      // 3. socket.sendMessage
      const sentViaSocket = socketService.sendMessage(activeConversationId, currentUser.id, ciphertext, iv);
      
      if (sentViaSocket) {
        // We rely on the server echo (via subscription) to confirm the message.
        // We can remove the optimistic message after a short delay or when the real one arrives.
        // For simplicity, we just leave it until the real one replaces it or we refresh.
        // In a perfect system, we'd reconcile the temporary ID with the real ID.
        setTimeout(() => {
          setMessages(prev => {
             const copy = structuredClone(prev);
             if (copy[activeConversationId]) {
                copy[activeConversationId] = copy[activeConversationId].filter((m: Message) => m.id !== tempId);
             }
             return copy;
          });
        }, 2000); // Remove temp message after 2s, assuming real one arrived
      } else {
        // Fallback to REST
        const responseMsg = await messageApi.send(activeConversationId, ciphertext, iv);
        processedMessageIds.current.add(responseMsg.id);
        
        setMessages(prev => {
          const copy = structuredClone(prev);
          if (copy[activeConversationId]) {
            copy[activeConversationId] = copy[activeConversationId].map((m: Message) => 
              m.id === tempId ? { ...responseMsg, text: textToSend, isSending: false } : m
            );
          }
          return copy;
        });
      }

    } catch (err) {
      console.error("Failed to send message:", err);
      alert("Failed to send message.");
    }
  };

  const handleLogout = () => {
    socketService.deactivate();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(LOGGED_IN_USER_KEY);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setCurrentUser(null);
    setConversations([]);
    setMessages({});
    setActiveConversationId(null);
    processedMessageIds.current.clear();
  };

  // Auto-scroll
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeConversationId]);

  if (!currentUser) {
    return <Auth onAuthSuccess={(user) => {
      setCurrentUser(user);
      // Trigger socket init immediately after login
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
         socketService.init(token);
         // We need to re-attach listener because the initial useEffect might have run before login
         // Ideally, we force a re-mount of App or handle this better, 
         // but simply calling init again is safe due to checks inside init.
         window.location.reload(); // Simplest way to ensure clean state on login for this architecture
      }
    }} />;
  }

  const activeConv = conversations.find(c => c.id === activeConversationId);
  const activeMessages = activeConversationId ? messages[activeConversationId] || [] : [];

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar */}
      <aside 
        className={`
          fixed inset-y-0 left-0 z-40 w-full md:w-80 bg-gray-50 border-r border-gray-200 transform transition-transform duration-200 ease-in-out
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          flex flex-col
        `}
      >
        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-kapsel-primary flex items-center justify-center text-white font-bold">
               {currentUser.displayName.charAt(0).toUpperCase()}
            </div>
            <span className="font-semibold text-gray-900 truncate max-w-[100px] text-sm">
               {currentUser.displayName}
            </span>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setShowNewChatModal(true)} className="p-2 hover:bg-gray-100 rounded-lg">
              <Plus className="w-5 h-5 text-gray-500" />
            </button>
            <button onClick={handleLogout} className="p-2 hover:bg-red-50 rounded-lg">
              <LogOut className="w-5 h-5 text-gray-500 hover:text-red-600" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center mt-10 p-4">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No conversations yet.</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`w-full p-3 flex items-center gap-3 rounded-lg text-left transition-colors ${activeConversationId === conv.id ? 'bg-white shadow-sm ring-1 ring-gray-200' : 'hover:bg-gray-100'}`}
              >
                <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-medium">
                   {(conv.otherUser?.displayName || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{conv.otherUser?.displayName}</p>
                  <p className="text-xs text-gray-500 truncate">{format(new Date(conv.createdAt), 'MMM d')}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat */}
      <main className={`flex-1 flex flex-col h-full md:ml-80 bg-white transition-opacity duration-200 ${isMobileMenuOpen ? 'opacity-50 pointer-events-none md:opacity-100 md:pointer-events-auto' : 'opacity-100'}`}>
        {activeConversationId && activeConv ? (
          <>
            <header className="h-16 border-b border-gray-200 flex items-center px-4 justify-between bg-white z-10 sticky top-0">
              <div className="flex items-center gap-3">
                <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 -ml-2 text-gray-500">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium">
                   {(activeConv.otherUser?.displayName || '?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{activeConv.otherUser?.displayName}</h3>
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <Lock className="w-3 h-3" /> <span>E2EE Secure</span>
                  </div>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
              {activeMessages.map((msg) => {
                const isMe = msg.senderId === currentUser.id;
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-4 py-2 rounded-2xl text-sm shadow-sm relative ${isMe ? 'bg-kapsel-primary text-white rounded-br-none' : 'bg-white text-gray-900 border border-gray-100 rounded-bl-none'} ${msg.isSending ? 'opacity-60' : 'opacity-100'}`}>
                      <p className="whitespace-pre-wrap break-words">{msg.text || '...'}</p>
                      <div className={`text-[10px] mt-1 text-right flex items-center justify-end gap-1 ${isMe ? 'text-gray-300' : 'text-gray-400'}`}>
                        {msg.isSending ? <span>Sending...</span> : format(new Date(msg.createdAt), 'HH:mm')}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex gap-2 items-end">
                <button type="button" className="p-3 text-gray-400 hover:bg-gray-100 rounded-full"><Paperclip className="w-5 h-5" /></button>
                <button type="button" className="p-3 text-gray-400 hover:bg-gray-100 rounded-full"><Camera className="w-5 h-5" /></button>
                <div className="flex-1 bg-gray-100 rounded-2xl flex items-center px-4 py-1 min-h-[44px]">
                   <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a secure message..."
                    className="flex-1 bg-transparent text-sm focus:outline-none min-h-[24px] py-2"
                  />
                </div>
                <button type="submit" disabled={!inputText.trim()} className="p-3 rounded-full bg-kapsel-primary text-white hover:bg-black disabled:opacity-50">
                  <Send className="w-5 h-5 ml-0.5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="hidden md:flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50/30">
            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
              <Lock className="w-10 h-10 text-gray-300" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">Welcome to Kapsel</h2>
            <p className="mt-2 text-sm text-gray-500">Select a conversation to start chatting.</p>
          </div>
        )}
      </main>

      {showNewChatModal && (
        <NewChatModal 
          onClose={() => setShowNewChatModal(false)} 
          onChatCreated={(conv) => {
            fetchConversations();
            handleSelectConversation(conv.id);
          }}
          currentUserMobile={currentUser.mobileNumber}
        />
      )}
    </div>
  );
};

export default App;