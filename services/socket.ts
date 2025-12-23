import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { WS_URL, AUTH_TOKEN_KEY } from '../constants';
import { Message } from '../types';

type MessageCallback = (message: Message) => void;
type ConnectionStatusCallback = (isConnected: boolean) => void;

class SocketService {
  private client: Client;
  private subscriptions: Map<string, any> = new Map();
  private messageCallbacks: Map<string, MessageCallback[]> = new Map();
  private statusCallbacks: Set<ConnectionStatusCallback> = new Set();
  private _isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor() {
    this.client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      
      reconnectDelay: 3000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      
      debug: (str) => {
        console.debug('[STOMP]', str);
      },

      onConnect: () => {
        console.log('✅ STOMP: Connected successfully');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusChange(true);
        
        // Resubscribe to all conversations
        this.messageCallbacks.forEach((_, conversationId) => {
          this._doSubscribe(conversationId);
        });
      },

      onDisconnect: () => {
        console.log('❌ STOMP: Disconnected');
        this._isConnected = false;
        this.notifyStatusChange(false);
      },

      onStompError: (frame) => {
        console.error('❌ STOMP Error:', frame.headers['message']);
        console.error('Details:', frame.body);
        this._isConnected = false;
        this.notifyStatusChange(false);
      },

      onWebSocketClose: (event) => {
        console.log('🔌 STOMP: WebSocket Closed', event);
        this._isConnected = false;
        this.notifyStatusChange(false);
        
        // Attempt reconnection
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`🔄 Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        }
      },

      onWebSocketError: (error) => {
        console.error('❌ WebSocket Error:', error);
      }
    });
  }

  get connected() {
    return this._isConnected;
  }

  onConnectionChange(callback: ConnectionStatusCallback) {
    this.statusCallbacks.add(callback);
    callback(this._isConnected);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  private notifyStatusChange(isConnected: boolean) {
    this.statusCallbacks.forEach(cb => cb(isConnected));
  }

  activate() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      this.client.connectHeaders = {
        Authorization: `Bearer ${token}`
      };
      console.log('🔐 STOMP: Activating with Auth Token');
    } else {
      console.warn('⚠️ STOMP: Activating without Auth Token');
    }

    try {
      this.client.activate();
    } catch (error) {
      console.error('❌ Failed to activate STOMP client:', error);
    }
  }

  deactivate() {
    console.log('🛑 STOMP: Deactivating...');
    this.subscriptions.forEach((sub, convId) => {
      try {
        sub.unsubscribe();
      } catch (e) {
        console.error(`Failed to unsubscribe from ${convId}:`, e);
      }
    });
    this.subscriptions.clear();
    this.messageCallbacks.clear();
    
    try {
      this.client.deactivate();
    } catch (error) {
      console.error('❌ Failed to deactivate STOMP client:', error);
    }
    
    this._isConnected = false;
    this.notifyStatusChange(false);
  }

  subscribeToConversation(conversationId: string, callback: MessageCallback) {
    console.log(`📥 Registering callback for conversation: ${conversationId}`);
    
    if (!this.messageCallbacks.has(conversationId)) {
      this.messageCallbacks.set(conversationId, []);
    }
    
    const callbacks = this.messageCallbacks.get(conversationId)!;
    if (!callbacks.includes(callback)) {
      callbacks.push(callback);
    }

    // Subscribe immediately if connected
    if (this._isConnected && !this.subscriptions.has(conversationId)) {
      this._doSubscribe(conversationId);
    }
  }

  private _doSubscribe(conversationId: string) {
    if (this.subscriptions.has(conversationId)) {
      console.log(`ℹ️ Already subscribed to: ${conversationId}`);
      return;
    }

    const destination = `/topic/conversations/${conversationId}`;
    console.log(`🔔 STOMP: Subscribing to ${destination}`);
    
    try {
      const sub = this.client.subscribe(destination, (message: IMessage) => {
        try {
          console.log(`📨 STOMP: Raw message received on ${destination}:`, message.body);
          const body: Message = JSON.parse(message.body);
          console.log(`📨 STOMP: Parsed message:`, body);
          
          const callbacks = this.messageCallbacks.get(conversationId);
          if (callbacks && callbacks.length > 0) {
            console.log(`🔔 Notifying ${callbacks.length} callback(s) for conversation ${conversationId}`);
            callbacks.forEach(cb => {
              try {
                cb(body);
              } catch (cbError) {
                console.error('❌ Callback error:', cbError);
              }
            });
          } else {
            console.warn(`⚠️ No callbacks registered for conversation ${conversationId}`);
          }
        } catch (err) {
          console.error('❌ STOMP: Failed to parse or handle message:', err);
        }
      });
      
      this.subscriptions.set(conversationId, sub);
      console.log(`✅ Successfully subscribed to ${destination}`);
    } catch (e) {
      console.error(`❌ STOMP: Subscribe failed for ${destination}:`, e);
    }
  }

  unsubscribeFromConversation(conversationId: string) {
    console.log(`🔕 STOMP: Unsubscribing from ${conversationId}`);
    const sub = this.subscriptions.get(conversationId);
    if (sub) {
      try {
        sub.unsubscribe();
        this.subscriptions.delete(conversationId);
        console.log(`✅ Unsubscribed from ${conversationId}`);
      } catch (e) {
        console.error(`❌ Failed to unsubscribe from ${conversationId}:`, e);
      }
    }
    this.messageCallbacks.delete(conversationId);
  }

  sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string): boolean {
    if (!this._isConnected) {
      console.warn('⚠️ STOMP: Not connected, cannot send via socket');
      return false;
    }

    try {
      const payload = {
        conversationId,
        senderId,
        ciphertext,
        iv
      };
      
      console.log('📤 STOMP: Sending message:', payload);
      
      this.client.publish({
        destination: '/app/chat.sendMessage',
        body: JSON.stringify(payload),
      });
      
      console.log('✅ STOMP: Message sent successfully');
      return true;
    } catch (e) {
      console.error("❌ STOMP: Publish failed:", e);
      return false;
    }
  }
}

export const socketService = new SocketService();