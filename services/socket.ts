import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import { WS_URL, AUTH_TOKEN_KEY } from '../constants';
import { Message } from '../types';

type MessageCallback = (message: Message) => void;
type ConnectionStatusCallback = (isConnected: boolean) => void;

class SocketService {
  private client: Client;
  private userSubscription: StompSubscription | null = null;
  private messageCallback: MessageCallback | null = null;
  private statusCallbacks: Set<ConnectionStatusCallback> = new Set();
  private _isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor() {
    this.client = new Client({
      brokerURL: WS_URL,
      
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
        this._subscribeToUserQueue();
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
    if (this.userSubscription) {
        try {
            this.userSubscription.unsubscribe();
        } catch (e) { /* ignore */ }
    }
    this.userSubscription = null;
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

  /**
   * Register a global handler for all incoming messages (user queue).
   */
  onMessage(callback: MessageCallback) {
    this.messageCallback = callback;
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
    this.messageCallback = null;
    
    try {
      this.client.deactivate();
    } catch (error) {
      console.error('Failed to deactivate STOMP client:', error);
    }
  }

  /**
   * Subscribes to the user-specific queue. 
   * Backend sends to /user/{userId}/queue/messages, client subscribes to /user/queue/messages.
   */
  private _subscribeToUserQueue() {
    if (this.userSubscription) {
      return;
    }

    // CRITICAL: Subscribe EXACTLY to /user/queue/messages per requirements
    const destination = '/user/queue/messages';
    console.log(`STOMP: Subscribing to ${destination}`);
    
    try {
      this.userSubscription = this.client.subscribe(destination, (message: IMessage) => {
        try {
          console.log('STOMP: Message received from queue:', message.body);
          const body: Message = JSON.parse(message.body);
          if (this.messageCallback) {
            this.messageCallback(body);
          }
        } catch (err) {
          console.error('STOMP: Failed to parse or handle message:', err);
        }
      });
    } catch (e) {
      console.error(`STOMP: Subscribe failed for ${destination}:`, e);
    }
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