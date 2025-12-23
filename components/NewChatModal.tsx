import React, { useState } from 'react';
import { userApi, conversationApi } from '../services/api';
import { Button } from './Button';
import { Input } from './Input';
import { X, UserPlus, AlertCircle } from 'lucide-react';
import { Conversation, User } from '../types';
import { USER_CACHE_KEY } from '../constants';

interface NewChatModalProps {
  onClose: () => void;
  onChatCreated: (conversation: Conversation) => void;
  currentUserMobile: string;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({ onClose, onChatCreated, currentUserMobile }) => {
  const [mobile, setMobile] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile === currentUserMobile) {
      setError("You cannot chat with yourself.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Find User
      const user = await userApi.getUserByMobile(mobile);
      
      // 2. Update Cache so we can display their name later
      const cacheStr = localStorage.getItem(USER_CACHE_KEY);
      const cache = cacheStr ? JSON.parse(cacheStr) : {};
      cache[user.id] = user;
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cache));

      // 3. Create Conversation
      const conversation = await conversationApi.createOrGet(user.id);
      
      // 4. Attach user for UI immediately
      conversation.otherUser = user;
      
      onChatCreated(conversation);
      onClose();
    } catch (err: any) {
      console.error(err);
      if (err.response && err.response.status === 404) {
        setError("User not found with this mobile number.");
      } else {
        setError("Failed to start chat. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            New Conversation
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-blue-50 text-blue-800 text-sm p-3 rounded-lg flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>Enter the mobile number of the person you want to chat with. They must be registered on Kapsel.</p>
          </div>

          <Input
            label="Mobile Number"
            placeholder="e.g. 9990002222"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            autoFocus
            required
          />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
          )}

          <div className="flex justify-end pt-2">
            <Button type="submit" isLoading={isLoading} className="w-full">
              Start Chatting
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};