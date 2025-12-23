import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import { WS_URL } from '../constants';
import { Message } from '../types';

type MessageCallback = (message: Message) => void;

class SocketService {
  private client: Client;
  private subscriptions: Map<string, any> = new Map();
  private messageCallbacks: Map<string, MessageCallback[]> = new Map();

  constructor() {
    this.client = new Client({
      // We purposefully do NOT set brokerURL when using webSocketFactory with SockJS
      // to avoid protocol conflicts.
      webSocketFactory: () => new SockJS(WS_URL),
      
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      
      // Add debug logging to console to trace STOMP traffic
      debug: (str) => {
        // Uncomment the line below if you want to see detailed STOMP frames in console
        // console.debug(str);
      },

      onConnect: () => {
        console.log('STOMP: Connected');
        // Resubscribe to all conversations that have registered callbacks
        // This ensures that if the connection dropped and came back, we re-establish logic
        this.messageCallbacks.forEach((_, conversationId) => {
          this._doSubscribe(conversationId);
        });
      },
      onDisconnect: () => {
        console.log('STOMP: Disconnected');
      },
      onStompError: (frame) => {
        console.error('STOMP: Broker reported error: ' + frame.headers['message']);
        console.error('STOMP: Additional details: ' + frame.body);
      },
      onWebSocketClose: () => {
        console.log('STOMP: WebSocket Closed');
      }
    });
  }

  get connected() {
    return this.client.connected;
  }

  activate() {
    this.client.activate();
  }

  deactivate() {
    this.client.deactivate();
  }

  subscribeToConversation(conversationId: string, callback: MessageCallback) {
    if (!this.messageCallbacks.has(conversationId)) {
      this.messageCallbacks.set(conversationId, []);
    }
    
    const callbacks = this.messageCallbacks.get(conversationId)!;
    if (!callbacks.includes(callback)) {
      callbacks.push(callback);
    }

    // Try to subscribe immediately
    if (this.client.connected) {
       this._doSubscribe(conversationId);
    } 
    // If not connected, onConnect will handle it via the messageCallbacks map
  }

  private _doSubscribe(conversationId: string) {
    // If we already have a STOMP subscription for this ID, don't create another one
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
      console.log(`STOMP: Unsubscribing from ${conversationId}`);
      const sub = this.subscriptions.get(conversationId);
      if (sub) {
          sub.unsubscribe();
          this.subscriptions.delete(conversationId);
      }
      this.messageCallbacks.delete(conversationId);
  }

  sendMessage(conversationId: string, senderId: string, ciphertext: string, iv: string): boolean {
    if (this.client.connected) {
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