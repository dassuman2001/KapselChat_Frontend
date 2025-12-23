import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Auth } from './components/Auth';
import { NewChatModal } from './components/NewChatModal';
import { Input } from './components/Input';
import { Button } from './components/Button';
import { 
  authApi, 
  userApi, 
  conversationApi, 
  messageApi 
} from './services/api';
import { socketService } from './services/socket';
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
  Search, 
  Menu,
  Lock,
  ArrowLeft,
  Wifi,
  WifiOff
} from 'lucide-react';
import { format } from 'date-fns';

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
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track all conversations we need to monitor
  const subscribedConversationsRef = useRef<Set<string>>(new Set());

  // Initialize Auth & Socket
  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const storedUser = localStorage.getItem(LOGGED_IN_USER_KEY);
    if (token && storedUser) {
      setCurrentUser(JSON.parse(storedUser));
      
      socketService.activate();
      
      const unsubscribe = socketService.onConnectionChange((isConnected) => {
        setIsSocketConnected(isConnected);
      });
      
      return () => {
        unsubscribe();
        socketService.deactivate();
      };
    }
  }, []);

  // Persist Active Conversation
  useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
    } else {
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    }
  }, [activeConversationId]);

  // Subscribe to ALL conversations, not just active one
  useEffect(() => {
    if (!currentUser || conversations.length === 0) return;

    // Handle realtime messages for ANY conversation
    const handleRealtimeMessage = async (msg: Message) => {
      console.log('Received realtime message:', msg);
      
      // Decrypt incoming real-time message
      let decryptedText = 'Decryption Failed';
      try {
        decryptedText = await decryptMessage(msg.ciphertext, msg.iv);
      } catch (e) {
        console.error("Failed to decrypt realtime message", e);
      }
      
      const msgWithText = { ...msg, text: decryptedText };
      
      setMessages(prev => {
        const currentList = prev[msg.conversationId] || [];
        
        // Better deduplication: check by timestamp and content
        const isDuplicate = currentList.some(m => 
          m.id === msg.id || 
          (m.senderId === msg.senderId && 
           m.ciphertext === msg.ciphertext && 
           Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 1000)
        );
        
        if (isDuplicate) {
          console.log('Duplicate message detected, skipping');
          return prev;
        }
        
        console.log('Adding new message to conversation:', msg.conversationId);
        return {
          ...prev,
          [msg.conversationId]: [...currentList, msgWithText].sort((a, b) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        };
      });
    };

    // Subscribe to ALL conversations
    conversations.forEach(conv => {
      if (!subscribedConversationsRef.current.has(conv.id)) {
        console.log('Subscribing to conversation:', conv.id);
        socketService.subscribeToConversation(conv.id, handleRealtimeMessage);
        subscribedConversationsRef.current.add(conv.id);
      }
    });

    // Cleanup: only unsubscribe from conversations that no longer exist
    return () => {
      const currentConvIds = new Set(conversations.map(c => c.id));
      subscribedConversationsRef.current.forEach(convId => {
        if (!currentConvIds.has(convId)) {
          console.log('Unsubscribing from removed conversation:', convId);
          socketService.unsubscribeFromConversation(convId);
          subscribedConversationsRef.current.delete(convId);
        }
      });
    };
  }, [conversations, currentUser]);

  // Load history only when conversation becomes active
  useEffect(() => {
    if (!activeConversationId || !currentUser) return;

    const loadHistory = async () => {
      // Only load if we don't have messages for this conversation
      if (messages[activeConversationId]?.length > 0) {
        console.log('Messages already loaded for:', activeConversationId);
        return;
      }

      try {
        console.log('Loading history for:', activeConversationId);
        const history = await messageApi.getForConversation(activeConversationId);
        
        const decryptedHistory = await Promise.all(history.map(async (m) => {
          let text = 'Decryption Failed';
          try {
            text = await decryptMessage(m.ciphertext, m.iv);
          } catch (e) { 
            console.error('Decryption error:', e); 
          }
          return { ...m, text };
        }));
        
        setMessages(prev => ({ 
          ...prev, 
          [activeConversationId]: decryptedHistory.sort((a, b) => 
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        }));
      } catch (err) {
        console.error("Failed to load history", err);
      }
    };

    loadHistory();
  }, [activeConversationId, currentUser]);

  // Fetch Conversations and Cache
  const fetchConversations = useCallback(async () => {
    if (!currentUser) return;
    try {
      const convs = await conversationApi.getAll();
      
      const cacheStr = localStorage.getItem(USER_CACHE_KEY);
      const cache = cacheStr ? JSON.parse(cacheStr) : {};
      const missingUserIds = new Set<string>();
      
      let resolvedConvs = convs.map(c => {
        const otherId = c.participantIds.find(id => id !== currentUser.id);
        const otherUser = otherId ? cache[otherId] : undefined;
        
        if (otherId && !otherUser) {
          missingUserIds.add(otherId);
        }
        
        return { ...c, otherUser };
      });
      
      setConversations(resolvedConvs);

      if (missingUserIds.size > 0) {
        try {
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
            resolvedConvs = convs.map(c => {
              const otherId = c.participantIds.find(id => id !== currentUser.id);
              const otherUser = otherId ? cache[otherId] : undefined;
              return { ...c, otherUser };
            });
            setConversations(resolvedConvs);
          }
        } catch (e) {
          console.error("Error resolving users", e);
        }
      }

    } catch (err) {
      console.error("Failed to fetch conversations", err);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchConversations();
    }
  }, [currentUser, fetchConversations]);

  const handleSelectConversation = (convId: string) => {
    setActiveConversationId(convId);
    setIsMobileMenuOpen(false);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversationId || !currentUser || !inputText.trim()) return;

    const textToSend = inputText.trim();
    setInputText('');

    const tempId = `temp-${Date.now()}-${Math.random()}`;

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

      setMessages(prev => ({
        ...prev,
        [activeConversationId]: [...(prev[activeConversationId] || []), optimisticMsg]
      }));

      // Try Socket First
      const sentViaSocket = socketService.sendMessage(activeConversationId, currentUser.id, ciphertext, iv);
      
      if (sentViaSocket) {
        console.log('Message sent via WebSocket');
        // Remove the optimistic message - the real one will come via WebSocket
        setTimeout(() => {
          setMessages(prev => ({
            ...prev,
            [activeConversationId]: prev[activeConversationId].filter(m => m.id !== tempId)
          }));
        }, 1000);
      } else {
        console.log('Socket not connected, using REST fallback...');
        const responseMsg = await messageApi.send(activeConversationId, ciphertext, iv);
        
        setMessages(prev => {
          const list = prev[activeConversationId] || [];
          return {
            ...prev,
            [activeConversationId]: list.map(m => 
              m.id === tempId 
                ? { ...responseMsg, text: textToSend, isSending: false } 
                : m
            )
          };
        });
      }

    } catch (err) {
      console.error("Failed to send message", err);
      setMessages(prev => {
        const list = prev[activeConversationId] || [];
        return {
          ...prev,
          [activeConversationId]: list.map(m => 
            m.id === tempId 
              ? { ...m, text: `${m.text} (Failed)`, isSending: undefined }
              : m
          )
        };
      });
      alert("Failed to send message. Please check your connection.");
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
  };

  // Scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeConversationId]);

  if (!currentUser) {
    return <Auth onAuthSuccess={(user) => {
      setCurrentUser(user);
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
        {/* Sidebar Header */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-kapsel-primary flex items-center justify-center text-white font-bold relative">
              {currentUser.avatarUrl ? (
                <img src={currentUser.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full" />
              ) : (
                currentUser.displayName.charAt(0).toUpperCase()
              )}
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isSocketConnected ? 'bg-green-500' : 'bg-red-500'}`} title={isSocketConnected ? 'Online' : 'Disconnected'} />
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-gray-900 truncate max-w-[100px] text-sm leading-tight">
                {currentUser.displayName}
              </span>
              <span className={`text-[10px] font-medium ${isSocketConnected ? 'text-green-600' : 'text-red-500'}`}>
                {isSocketConnected ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            <button 
              onClick={() => setShowNewChatModal(true)}
              className="p-2 text-gray-500 hover:text-kapsel-primary hover:bg-gray-100 rounded-lg transition-colors"
              title="New Chat"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center mt-10 p-4">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No conversations yet.</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowNewChatModal(true)}>
                Start a chat
              </Button>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`
                  w-full p-3 flex items-center gap-3 rounded-lg text-left transition-colors
                  ${activeConversationId === conv.id ? 'bg-white shadow-sm ring-1 ring-gray-200' : 'hover:bg-gray-100'}
                `}
              >
                <div className="w-10 h-10 rounded-full bg-gray-200 flex-shrink-0 flex items-center justify-center text-gray-600 font-medium overflow-hidden">
                   {conv.otherUser?.avatarUrl ? (
                      <img src={conv.otherUser.avatarUrl} alt="" className="w-full h-full object-cover"/>
                   ) : (
                      (conv.otherUser?.displayName || '?').charAt(0).toUpperCase()
                   )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {conv.otherUser?.displayName || `User ${conv.participantIds.find(id => id !== currentUser.id)?.slice(0,4)}...`}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    {format(new Date(conv.createdAt), 'MMM d, yyyy')}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className={`flex-1 flex flex-col h-full md:ml-80 bg-white transition-opacity duration-200 ${isMobileMenuOpen ? 'opacity-50 pointer-events-none md:opacity-100 md:pointer-events-auto' : 'opacity-100'}`}>
        {activeConversationId && activeConv ? (
          <>
            {/* Chat Header */}
            <header className="h-16 border-b border-gray-200 flex items-center px-4 justify-between bg-white z-10 sticky top-0">
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setIsMobileMenuOpen(true)}
                  className="md:hidden p-2 -ml-2 text-gray-500 hover:text-gray-700"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium overflow-hidden">
                   {activeConv.otherUser?.avatarUrl ? (
                      <img src={activeConv.otherUser.avatarUrl} alt="" className="w-full h-full object-cover"/>
                   ) : (
                      (activeConv.otherUser?.displayName || '?').charAt(0).toUpperCase()
                   )}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {activeConv.otherUser?.displayName || 'Unknown User'}
                  </h3>
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <Lock className="w-3 h-3" />
                    <span>End-to-End Encrypted</span>
                  </div>
                </div>
              </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
              <div className="text-center text-xs text-gray-400 my-4">
                <span className="bg-gray-100 px-2 py-1 rounded-full">
                  Messages are secured with client-side encryption
                </span>
              </div>
              
              {activeMessages.map((msg) => {
                const isMe = msg.senderId === currentUser.id;
                return (
                  <div 
                    key={msg.id} 
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div 
                      className={`
                        max-w-[70%] px-4 py-2 rounded-2xl text-sm shadow-sm relative
                        ${isMe 
                          ? 'bg-kapsel-primary text-white rounded-br-none' 
                          : 'bg-white text-gray-900 border border-gray-100 rounded-bl-none'
                        }
                      `}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.text || 'Decryption Failed'}</p>
                      <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-gray-300' : 'text-gray-400'}`}>
                        {msg.createdAt && !msg.id.startsWith('temp') 
                          ? format(new Date(msg.createdAt), 'HH:mm') 
                          : 'Sending...'}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-200">
              <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a secure message..."
                  className="flex-1 h-11 bg-gray-100 rounded-full px-5 text-sm focus:outline-none focus:ring-2 focus:ring-kapsel-primary/20 transition-all"
                />
                <button
                  type="submit"
                  disabled={!inputText.trim()}
                  title="Send"
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-kapsel-primary text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
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
            <p className="mt-2 max-w-sm text-center text-gray-500">
              Select a conversation from the sidebar or start a new one to begin messaging securely.
            </p>
          </div>
        )}
      </main>

      {/* New Chat Modal */}
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