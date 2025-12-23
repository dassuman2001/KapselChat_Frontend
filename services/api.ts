import axios from 'axios';
import { API_BASE_URL, AUTH_TOKEN_KEY } from '../constants';
import { LoginRequest, SignupRequest, AuthResponse, User, Conversation, Message } from '../types';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      // Handle unauthorized access (e.g., redirect to login)
      // In a real app, we might trigger a global event or generic logout
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  signup: async (data: SignupRequest): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/auth/signup', data);
    return response.data;
  },
  login: async (data: LoginRequest): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/auth/login', data);
    return response.data;
  },
};

export const userApi = {
  getCurrentUser: async (): Promise<User> => {
    const response = await api.get<User>('/users/me');
    return response.data;
  },
  getUserByMobile: async (mobileNumber: string): Promise<User> => {
    const response = await api.get<User>(`/users/by-mobile/${mobileNumber}`);
    return response.data;
  },
  // Added to resolve users when loading conversations from history
  getUser: async (id: string): Promise<User> => {
    const response = await api.get<User>(`/users/${id}`);
    return response.data;
  },
};

export const conversationApi = {
  createOrGet: async (otherUserId: string): Promise<Conversation> => {
    const response = await api.post<Conversation>('/conversations', { otherUserId });
    return response.data;
  },
  getAll: async (): Promise<Conversation[]> => {
    const response = await api.get<Conversation[]>('/conversations');
    return response.data;
  },
};

export const messageApi = {
  send: async (conversationId: string, ciphertext: string, iv: string): Promise<Message> => {
    const response = await api.post<Message>('/messages', {
      conversationId,
      ciphertext,
      iv,
    });
    return response.data;
  },
  getForConversation: async (conversationId: string): Promise<Message[]> => {
    const response = await api.get<Message[]>(`/messages/conversation/${conversationId}`);
    return response.data;
  },
};

export default api;