import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { WS_URL } from '../constants';
import { Message } from '../types';

type MessageCallback = (message: Message) => void;

class SocketService {
  private client: Client;
  private subscriptions: Map<string, any> = new Map();
  private _isConnected: boolean = false;
  private messageCallbacks: Map<string, MessageCallback[]> = new Map();

  constructor() {
    this.client = new Client({
      brokerURL: WS_URL.replace('http', 'ws'), // e.g. ws://localhost:8080/ws
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      // SockJS fallback for browsers/environments that need it or if raw WS fails
      webSocketFactory: () => new SockJS(WS_URL),
      onConnect: () => {
        console.log('STOMP Connected');
        this._isConnected = true;
        // Resubscribe to active topics if connection was lost
        this.subscriptions.forEach((_, conversationId) => {
          this._doSubscribe(conversationId);
        });
      },
      onDisconnect: () => {
        console.log('STOMP Disconnected');
        this._isConnected = false;
      },
      onStompError: (frame) => {
        console.error('Broker reported error: ' + frame.headers['message']);
        console.error('Additional details: ' + frame.body);
      },
      onWebSocketClose: () => {
        this._isConnected = false;
      }
    });
  }

  get connected() {
    return this._isConnected;
  }

  activate() {
    this.client.activate();
  }

  deactivate() {
    this.client.deactivate();
    this._isConnected = false;
  }

  subscribeToConversation(conversationId: string, callback: MessageCallback) {
    if (!this.messageCallbacks.has(conversationId)) {
      this.messageCallbacks.set(conversationId, []);
    }
    this.messageCallbacks.get(conversationId)?.push(callback);

    if (this._isConnected) {
       this._doSubscribe(conversationId);
    } 
    // If not connected, onConnect will handle subscription
  }

  private _doSubscribe(conversationId: string) {
    // Avoid double subscription
    if (this.subscriptions.has(conversationId)) {
      this.subscriptions.get(conversationId).unsubscribe();
    }

    const sub = this.client.subscribe(`/topic/conversations/${conversationId}`, (message: IMessage) => {
        const body: Message = JSON.parse(message.body);
        const callbacks = this.messageCallbacks.get(conversationId);
        if (callbacks) {
            callbacks.forEach(cb => cb(body));
        }
    });
    this.subscriptions.set(conversationId, sub);
  }

  unsubscribeFromConversation(conversationId: string) {
      const sub = this.subscriptions.get(conversationId);
      if (sub) {
          sub.unsubscribe();
          this.subscriptions.delete(conversationId);
      }
      this.messageCallbacks.delete(conversationId);
  }

  sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string): boolean {
    if (this._isConnected && this.client.connected) {
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
        console.error("Socket publish failed", e);
        return false;
      }
    } else {
      console.warn('Socket not connected, client should fall back to REST');
      return false;
    }
  }
}

export const socketService = new SocketService();