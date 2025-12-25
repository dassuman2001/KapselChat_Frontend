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
  Camera,
  MoreVertical,
  Check,
  CheckCheck
} from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
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
  
  // Mobile Menu State
  // Default: Open if no chat selected, Closed if chat selected (on mobile)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(!activeConversationId);

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
    setIsMobileMenuOpen(false); // Close menu on mobile
  };

  const handleBackToMenu = () => {
    setIsMobileMenuOpen(true);
    // Optional: setActiveConversationId(null) if we want to "close" the chat logic-wise
    // But keeping it selected allows returning to the same state. 
    // Usually, back button just shows the list.
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
        setTimeout(() => {
          setMessages(prev => {
             const copy = structuredClone(prev);
             if (copy[activeConversationId]) {
                copy[activeConversationId] = copy[activeConversationId].filter((m: Message) => m.id !== tempId);
             }
             return copy;
          });
        }, 3000); 
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
  }, [messages, activeConversationId, isMobileMenuOpen]);

  const formatMessageTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return format(date, 'h:mm a'); 
  };
  
  const getInitials = (name?: string) => {
    return (name || '?').charAt(0).toUpperCase();
  };

  if (!currentUser) {
    return <Auth onAuthSuccess={(user) => {
      setCurrentUser(user);
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
         socketService.init(token);
         window.location.reload(); 
      }
    }} />;
  }

  const activeConv = conversations.find(c => c.id === activeConversationId);
  const activeMessages = activeConversationId ? messages[activeConversationId] || [] : [];

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      {/* Sidebar - Responsive */}
      <aside 
        className={`
          fixed inset-y-0 left-0 z-50 w-full md:w-80 bg-white border-r border-gray-200 
          transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
          flex flex-col shadow-xl md:shadow-none
        `}
      >
        {/* Sidebar Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-kapsel-primary flex items-center justify-center text-white font-bold shadow-sm">
                 {getInitials(currentUser.displayName)}
              </div>
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white"></div>
            </div>
            <span className="font-semibold text-gray-900 truncate max-w-[120px] text-sm">
               {currentUser.displayName}
            </span>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setShowNewChatModal(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600" title="New Chat">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={handleLogout} className="p-2 hover:bg-red-50 hover:text-red-600 rounded-full transition-colors text-gray-600" title="Logout">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 px-6 text-center">
              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-gray-300" />
              </div>
              <p className="text-gray-900 font-medium text-sm">No chats yet</p>
              <p className="text-gray-500 text-xs mt-1">Start a new conversation to begin secure messaging.</p>
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => setShowNewChatModal(true)}>
                Start Chat
              </Button>
            </div>
          ) : (
            <div className="py-2">
              {conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`
                    w-full px-4 py-3 flex items-center gap-3 text-left transition-colors border-l-4
                    ${activeConversationId === conv.id 
                      ? 'bg-blue-50 border-blue-600' 
                      : 'border-transparent hover:bg-gray-50'
                    }
                  `}
                >
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-600 font-medium shrink-0 border border-gray-100">
                     {getInitials(conv.otherUser?.displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <p className={`font-semibold text-sm truncate ${activeConversationId === conv.id ? 'text-blue-900' : 'text-gray-900'}`}>
                        {conv.otherUser?.displayName}
                      </p>
                      <span className="text-[10px] text-gray-400">
                        {format(new Date(conv.createdAt), 'MMM d')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Encrypted message
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full bg-[#f0f2f5] relative w-full min-w-0">
        {activeConversationId && activeConv ? (
          <>
            {/* Chat Header */}
            <header className="h-16 flex items-center justify-between px-4 bg-white border-b border-gray-200 shadow-sm shrink-0 z-10">
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleBackToMenu} 
                  className="md:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                
                <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-700">
                   {getInitials(activeConv.otherUser?.displayName)}
                </div>
                
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">
                    {activeConv.otherUser?.displayName}
                  </h3>
                  <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                    <Lock className="w-3 h-3" /> 
                    <span>End-to-End Encrypted</span>
                  </div>
                </div>
              </div>
              
              <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full">
                <MoreVertical className="w-5 h-5" />
              </button>
            </header>

            {/* Messages Area */}
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-contain" 
              style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}
            >
              {activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60">
                  <Lock className="w-16 h-16 mb-4" />
                  <p className="text-sm">No messages yet</p>
                  <p className="text-xs mt-1">Send a message to start the conversation</p>
                </div>
              ) : (
                activeMessages.map((msg, index) => {
                  const isMe = msg.senderId === currentUser.id;
                  const showDate = index === 0 || 
                    new Date(msg.createdAt).toDateString() !== new Date(activeMessages[index-1].createdAt).toDateString();
                  
                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                         <div className="flex justify-center my-4">
                           <span className="bg-gray-200 text-gray-600 text-[10px] font-medium px-2 py-1 rounded-full uppercase tracking-wider">
                             {format(new Date(msg.createdAt), 'MMM d, yyyy')}
                           </span>
                         </div>
                      )}
                      <div className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div 
                          className={`
                            relative max-w-[85%] md:max-w-[65%] px-3 py-2 shadow-sm text-[15px] leading-relaxed
                            ${isMe 
                              ? 'bg-kapsel-primary text-white rounded-2xl rounded-tr-sm' 
                              : 'bg-white text-gray-900 rounded-2xl rounded-tl-sm border border-gray-100'
                            }
                          `}
                        >
                          {/* Message Text with forced breaks for long words */}
                          <p className="break-words break-all whitespace-pre-wrap min-w-[2rem]">
                            {msg.text || '...'}
                          </p>
                          
                          {/* Metadata */}
                          <div className={`
                            flex items-center justify-end gap-1 mt-1 text-[10px] select-none
                            ${isMe ? 'text-gray-300' : 'text-gray-400'}
                          `}>
                            <span>{formatMessageTime(msg.createdAt)}</span>
                            {isMe && (
                              <span className={msg.isSending ? 'opacity-70' : ''}>
                                {msg.isSending ? <div className="w-2 h-2 rounded-full border border-current opacity-50" /> : <CheckCheck className="w-3 h-3" />}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 md:p-4 bg-white border-t border-gray-200 shrink-0">
              <div className="max-w-4xl mx-auto w-full">
                <form onSubmit={handleSendMessage} className="flex gap-2 items-end bg-gray-50 p-1.5 rounded-[26px] border border-gray-200 focus-within:border-gray-300 focus-within:ring-1 focus-within:ring-gray-300 transition-all shadow-sm">
                  <button type="button" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition-colors ml-1">
                    <Plus className="w-6 h-6" />
                  </button>
                  
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 bg-transparent text-gray-900 placeholder-gray-500 focus:outline-none py-2.5 px-2 text-sm max-h-32 overflow-y-auto"
                  />
                  
                  {inputText.trim() ? (
                    <button 
                      type="submit" 
                      className="p-2.5 bg-kapsel-primary text-white rounded-full hover:bg-black transition-all shadow-md transform hover:scale-105 active:scale-95"
                    >
                      <Send className="w-4 h-4 ml-0.5" />
                    </button>
                  ) : (
                    <div className="flex gap-1 mr-1">
                      <button type="button" className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition-colors">
                        <Camera className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </form>
              </div>
            </div>
          </>
        ) : (
          /* Empty State Desktop */
          <div className="hidden md:flex flex-col items-center justify-center h-full text-center p-8 bg-[#f0f2f5]">
            <div className="w-40 h-40 bg-gray-100 rounded-full flex items-center justify-center mb-8 shadow-inner animate-pulse">
              <Lock className="w-16 h-16 text-gray-300" />
            </div>
            <h2 className="text-2xl font-light text-gray-800 mb-2">Welcome to Kapsel</h2>
            <p className="text-gray-500 max-w-sm">
              Send and receive messages without keeping your phone online.
              <br/>Use Kapsel on up to 4 linked devices and 1 phone.
            </p>
            <div className="mt-8 flex items-center gap-2 text-xs text-gray-400">
              <Lock className="w-3 h-3" /> End-to-end encrypted
            </div>
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