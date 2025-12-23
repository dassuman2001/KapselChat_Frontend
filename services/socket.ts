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
  
  // Track internal state to allow UI to query immediately
  private _isConnected: boolean = false;

  constructor() {
    this.client = new Client({
      // Use SockJS
      webSocketFactory: () => new SockJS(WS_URL),
      
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      
      // Debug logging
      debug: (str) => {
        // console.debug(str);
      },

      onConnect: () => {
        console.log('STOMP: Connected');
        this._isConnected = true;
        this.notifyStatusChange(true);
        
        // Resubscribe to all conversations that have registered callbacks
        this.messageCallbacks.forEach((_, conversationId) => {
          this._doSubscribe(conversationId);
        });
      },
      onDisconnect: () => {
        console.log('STOMP: Disconnected');
        this._isConnected = false;
        this.notifyStatusChange(false);
      },
      onStompError: (frame) => {
        console.error('STOMP: Broker reported error: ' + frame.headers['message']);
        console.error('STOMP: Additional details: ' + frame.body);
      },
      onWebSocketClose: () => {
        console.log('STOMP: WebSocket Closed');
        this._isConnected = false;
        this.notifyStatusChange(false);
      }
    });
  }

  get connected() {
    return this._isConnected;
  }

  // Allow UI components to listen for connection changes
  onConnectionChange(callback: ConnectionStatusCallback) {
    this.statusCallbacks.add(callback);
    // Immediately fire with current status
    callback(this._isConnected);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  private notifyStatusChange(isConnected: boolean) {
    this.statusCallbacks.forEach(cb => cb(isConnected));
  }

  activate() {
    // CRITICAL: Inject the JWT token into the headers before connecting.
    // Without this, the backend will treat us as an anonymous user and likely
    // ignore subscription requests to protected topics.
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      this.client.connectHeaders = {
        Authorization: `Bearer ${token}`
      };
      console.log('STOMP: Activating with Auth Token');
    } else {
      console.warn('STOMP: Activating without Auth Token');
    }

    this.client.activate();
  }

  deactivate() {
    this.client.deactivate();
    this._isConnected = false;
    this.notifyStatusChange(false);
  }

  subscribeToConversation(conversationId: string, callback: MessageCallback) {
    if (!this.messageCallbacks.has(conversationId)) {
      this.messageCallbacks.set(conversationId, []);
    }
    
    const callbacks = this.messageCallbacks.get(conversationId)!;
    if (!callbacks.includes(callback)) {
      callbacks.push(callback);
    }

    // Try to subscribe immediately if connected
    if (this._isConnected) {
       this._doSubscribe(conversationId);
    } 
  }

  private _doSubscribe(conversationId: string) {
    if (this.subscriptions.has(conversationId)) {
      return;
    }

    console.log(`STOMP: Subscribing to topic /topic/conversations/${conversationId}`);
    
    try {
      const sub = this.client.subscribe(`/topic/conversations/${conversationId}`, (message: IMessage) => {
          try {
            console.log('STOMP: Received message', message.body);
            const body: Message = JSON.parse(message.body);
            const callbacks = this.messageCallbacks.get(conversationId);
            if (callbacks) {
                callbacks.forEach(cb => cb(body));
            }
          } catch (err) {
            console.error('STOMP: Failed to parse or handle message', err);
          }
      });
      this.subscriptions.set(conversationId, sub);
    } catch (e) {
      console.error('STOMP: Subscribe failed', e);
    }
  }

  unsubscribeFromConversation(conversationId: string) {
      // We don't remove the callback list immediately if we want to keep them for reconnection
      // But typically we do:
      console.log(`STOMP: Unsubscribing from ${conversationId}`);
      const sub = this.subscriptions.get(conversationId);
      if (sub) {
          sub.unsubscribe();
          this.subscriptions.delete(conversationId);
      }
      this.messageCallbacks.delete(conversationId);
  }

  sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string): boolean {
    if (this._isConnected) {
      try {
        this.client.publish({
          destination: '/app/chat.sendMessage',
          body: JSON.stringify({
            conversationId,
            senderId,
            ciphertext,
            iv
          }),
        });
        return true;
      } catch (e) {
        console.error("STOMP: Publish failed", e);
        return false;
      }
    } else {
      console.warn('STOMP: Not connected, cannot send via socket');
      return false;
    }
  }
}

export const socketService = new SocketService();