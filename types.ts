export interface User {
  id: string;
  mobileNumber: string;
  displayName: string;
  avatarUrl: string | null;
  publicKey?: string | null;
  encryptedPrivateKey?: string | null;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  createdAt: string;
  // UI helper property to store resolved participant details
  otherUser?: User;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  // UI helper for decrypted text
  text?: string;
  isSending?: boolean;
}

export interface AuthResponse {
  token: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  mobileNumber: string;
}

export interface LoginRequest {
  mobileNumber: string;
  password?: string;
}

export interface SignupRequest {
  mobileNumber: string;
  password?: string;
  displayName: string;
  avatarUrl?: string | null;
  publicKey?: string;
  encryptedPrivateKey?: string;
}