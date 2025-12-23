import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { WS_URL, AUTH_TOKEN_KEY } from '../constants';
import { Message } from '../types';

type MessageCallback = (message: Message) => void;
type ConnectionStatusCallback = (isConnected: boolean) => void;

class SocketService {
  private client: Client;
  private subscriptions: Map<string, StompSubscription> = new Map();
  private callbacks: Map<string, MessageCallback> = new Map();
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
        // console.debug('[STOMP]', str);
      },

      onConnect: () => {
        console.log('STOMP: Connected successfully');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusChange(true);
        this.resubscribe();
      },

      onDisconnect: () => {
        console.log('STOMP: Disconnected');
        this.handleDisconnect();
      },

      onStompError: (frame) => {
        console.error('STOMP Error:', frame.headers['message']);
        this.handleDisconnect();
      },

      onWebSocketClose: () => {
        console.log('STOMP: WebSocket Closed');
        this.handleDisconnect();
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Attempting reconnection (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        }
      }
    });
  }

  private handleDisconnect() {
    this._isConnected = false;
    this.notifyStatusChange(false);
    // Clear actual STOMP subscription objects, but keep the callbacks 
    // so we can resubscribe when we reconnect.
    this.subscriptions.clear();
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
      console.log('STOMP: Activating with Auth Token');
    } else {
      console.warn('STOMP: Activating without Auth Token');
    }

    try {
      this.client.activate();
    } catch (error) {
      console.error('Failed to activate STOMP client:', error);
    }
  }

  deactivate() {
    console.log('STOMP: Deactivating...');
    this.handleDisconnect();
    this.callbacks.clear();
    
    try {
      this.client.deactivate();
    } catch (error) {
      console.error('Failed to deactivate STOMP client:', error);
    }
  }

  /**
   * Subscribe to a specific destination (topic).
   * Stores the callback to handle reconnections automatically.
   */
  subscribe(destination: string, callback: MessageCallback) {
    // Store the callback
    this.callbacks.set(destination, callback);
    
    // If already connected, perform the STOMP subscription immediately
    if (this._isConnected) {
      this.doSubscribe(destination, callback);
    }
  }

  /**
   * Unsubscribe from a destination.
   */
  unsubscribe(destination: string) {
    const sub = this.subscriptions.get(destination);
    if (sub) {
      try {
        sub.unsubscribe();
      } catch (e) {
        console.warn(`Failed to unsubscribe from ${destination}`, e);
      }
      this.subscriptions.delete(destination);
    }
    this.callbacks.delete(destination);
  }

  private doSubscribe(destination: string, callback: MessageCallback) {
    // Prevent duplicate subscriptions to the same topic
    if (this.subscriptions.has(destination)) {
        return;
    }

    console.log(`STOMP: Subscribing to ${destination}`);
    
    try {
      const sub = this.client.subscribe(destination, (message: IMessage) => {
        try {
          const body: Message = JSON.parse(message.body);
          callback(body);
        } catch (err) {
          console.error('STOMP: Failed to parse or handle message:', err);
        }
      });
      this.subscriptions.set(destination, sub);
    } catch (e) {
      console.error(`STOMP: Subscribe failed for ${destination}:`, e);
    }
  }

  private resubscribe() {
    console.log('STOMP: Resubscribing to active topics...');
    this.callbacks.forEach((cb, destination) => {
      this.doSubscribe(destination, cb);
    });
  }

  sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string): boolean {
    if (!this._isConnected) {
      console.warn('STOMP: Not connected, cannot send via socket');
      return false;
    }

    try {
      const payload = {
        conversationId,
        senderId,
        ciphertext,
        iv
      };
      
      this.client.publish({
        destination: '/app/chat.sendMessage',
        body: JSON.stringify(payload),
      });
      
      return true;
    } catch (e) {
      console.error("STOMP: Publish failed:", e);
      return false;
    }
  }
}

export const socketService = new SocketService();