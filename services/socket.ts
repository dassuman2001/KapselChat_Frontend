import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import { WS_URL } from '../constants';
import { Message } from '../types';
// @ts-ignore
import SockJS from 'sockjs-client';

type MessageCallback = (message: Message) => void;

class SocketService {
  private client: Client;
  private messageCallback: MessageCallback | null = null;
  private subscription: StompSubscription | null = null;
  private isInitialized = false;

  constructor() {
    this.client = new Client({
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,

      onConnect: () => {
        console.log("🟢 WebSocket Connected!");
        if (this.messageCallback) {
          this._subscribeInternal();
        }
      },

      onDisconnect: () => {
        console.log('🔴 STOMP: Disconnected');
      },

      onStompError: (frame) => {
        console.error('⚠️ STOMP Error:', frame.headers['message']);
        console.error('Details:', frame.body);
      },

      onWebSocketClose: () => {
        console.log('🔌 WebSocket Closed');
      }
    });
  }

  public init(token: string) {
    if (this.isInitialized && this.client.active) {
      console.log('✅ Already connected');
      return;
    }

    console.log('🚀 Initializing WebSocket...');

    // Convert wss:// to https:// for SockJS
    const baseUrl = WS_URL
      .replace("wss://", "https://")
      .replace("ws://", "http://");

    // 🔥 CRITICAL FIX: Backend expects token as query param
    const urlWithToken = `${baseUrl}?token=${token}`;

    this.client.webSocketFactory = () => {
      console.log('🔗 Connecting to:', urlWithToken);
      return new SockJS(urlWithToken);
    };

    // Don't use connectHeaders - backend reads from URL
    this.client.connectHeaders = {};

    try {
      this.client.activate();
      this.isInitialized = true;
      console.log('✅ STOMP activated');
    } catch (e) {
      console.error('❌ Activation failed:', e);
    }
  }

  public subscribeUserQueue(callback: MessageCallback) {
    console.log('📡 Setting up message listener');
    this.messageCallback = callback;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    if (this.client.connected) {
      this._subscribeInternal();
    } else {
      console.log('⏳ Waiting for connection...');
    }

    return () => {
      console.log('🧹 Cleanup subscription');
      if (this.subscription) {
        this.subscription.unsubscribe();
        this.subscription = null;
      }
      this.messageCallback = null;
    };
  }

  private _subscribeInternal() {
    const destination = '/user/queue/messages';
    console.log(`📬 Subscribing to: ${destination}`);

    try {
      this.subscription = this.client.subscribe(destination, (message: IMessage) => {
        console.log('📨 Message received!');
        try {
          const body: Message = JSON.parse(message.body);
          console.log('✅ Parsed message ID:', body.id);
          if (this.messageCallback) {
            this.messageCallback(body);
          }
        } catch (e) {
          console.error('❌ Parse error:', e);
        }
      });
      console.log('✅ Subscription active');
    } catch (e) {
      console.error('❌ Subscribe failed:', e);
    }
  }

  public sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string): boolean {
    if (!this.client.connected) {
      console.warn('⚠️ Not connected, cannot send');
      return false;
    }

    const payload = {
      conversationId,
      senderId,
      ciphertext,
      iv
    };

    console.log('📤 Sending message:', { conversationId, senderId });

    try {
      this.client.publish({
        destination: '/app/chat.sendMessage',
        body: JSON.stringify(payload)
      });
      console.log('✅ Message sent via WebSocket');
      return true;
    } catch (e) {
      console.error('❌ Send failed:', e);
      return false;
    }
  }

  public deactivate() {
    console.log('🛑 Deactivating');
    this.isInitialized = false;
    this.messageCallback = null;
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.client.deactivate();
  }

  public isConnected(): boolean {
    return this.client.connected;
  }
}

export const socketService = new SocketService();