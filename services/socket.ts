import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import { WS_URL } from '../constants';
import { Message } from '../types';

type MessageCallback = (message: Message) => void;

class SocketService {
  private client: Client;
  private messageCallback: MessageCallback | null = null;
  private subscription: StompSubscription | null = null;
  
  // Track if we have explicitly initialized
  private isInitialized = false;

  constructor() {
    this.client = new Client({
      // We will set brokerURL dynamically in init()
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      
      // Native WebSocket options (no SockJS)
      forceBinaryWSFrames: true,
      appendMissingNULLonIncoming: true,

      onConnect: () => {
        console.log('✅ STOMP: Connected to Native WebSocket');
        // If we have a registered callback but no subscription yet (e.g. connection came after subscribe call)
        // we trigger subscription here.
        if (this.messageCallback && !this.subscription) {
            this._subscribeInternal();
        }
      },

      onDisconnect: () => {
        console.log('❌ STOMP: Disconnected');
      },

      onStompError: (frame) => {
        console.error('⚠️ STOMP Error:', frame.headers['message']);
        console.error('Details:', frame.body);
      },

      onWebSocketClose: () => {
        console.log('🔌 STOMP: WebSocket Closed');
      }
    });
  }

  /**
   * Initialize the connection ONCE.
   * Passing the token allows constructing the wss://.../?token=... URL
   */
  public init(token: string) {
    if (this.isInitialized && this.client.active) {
      console.log('STOMP: Already initialized and active, skipping.');
      return;
    }

    console.log('STOMP: Initializing connection...');
    
    this.client.brokerURL = `${WS_URL}?token=${token}`;
    
    this.client.connectHeaders = {
      Authorization: `Bearer ${token}`
    };

    try {
      this.client.activate();
      this.isInitialized = true;
    } catch (e) {
      console.error('STOMP: Activation failed', e);
    }
  }

  /**
   * subscribeUserQueue(callback)
   * Handles subscription to the user queue. Returns cleanup function.
   */
  public subscribeUserQueue(callback: MessageCallback) {
    this.messageCallback = callback;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    if (this.client.connected) {
      this._subscribeInternal();
    }

    return () => {
      this.subscription?.unsubscribe();
      this.subscription = null;
      // We also clear the callback to prevent stale closures if onConnect triggers later
      this.messageCallback = null; 
    };
  }

  /**
   * Internal method to handle the actual STOMP subscription frame.
   */
  private _subscribeInternal() {
    const destination = '/user/queue/messages';
    console.log(`STOMP: Subscribing to ${destination}`);

    try {
      this.subscription = this.client.subscribe(destination, (message: IMessage) => {
        try {
          const body: Message = JSON.parse(message.body);
          if (this.messageCallback) {
            this.messageCallback(body);
          }
        } catch (e) {
          console.error('STOMP: Failed to parse incoming message', e);
        }
      });
    } catch (e) {
      console.error('STOMP: Subscription failed', e);
    }
  }

  /**
   * sendMessage(conversationId, ciphertext, iv)
   */
  public sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string) {
    if (!this.client.connected) {
      console.warn('STOMP: Cannot send, socket not connected.');
      return false;
    }

    const payload = {
      conversationId,
      senderId,
      ciphertext,
      iv
    };

    try {
      this.client.publish({
        destination: '/app/chat.sendMessage',
        body: JSON.stringify(payload)
      });
      return true;
    } catch (e) {
      console.error('STOMP: Publish error', e);
      return false;
    }
  }

  public deactivate() {
    this.isInitialized = false;
    this.messageCallback = null;
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.client.deactivate();
  }
}

export const socketService = new SocketService();