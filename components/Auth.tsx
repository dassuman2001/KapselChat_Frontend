import React, { useState } from 'react';
import { authApi } from '../services/api';
import { AUTH_TOKEN_KEY, LOGGED_IN_USER_KEY, USER_CACHE_KEY } from '../constants';
import { Button } from './Button';
import { Input } from './Input';
import { User } from '../types';

interface AuthProps {
  onAuthSuccess: (user: User) => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    mobileNumber: '',
    password: '',
    displayName: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      let response;
      if (isLogin) {
        response = await authApi.login({
          mobileNumber: formData.mobileNumber,
          password: formData.password
        });
      } else {
        // Basic key generation would go here for a real E2EE implementation
        // For now, we omit the keys or send null as per optional fields
        response = await authApi.signup({
          mobileNumber: formData.mobileNumber,
          password: formData.password,
          displayName: formData.displayName,
          avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.displayName)}&background=random`
        });
      }

      // Store Auth Data
      localStorage.setItem(AUTH_TOKEN_KEY, response.token);
      
      const user: User = {
        id: response.userId,
        displayName: response.displayName,
        mobileNumber: response.mobileNumber,
        avatarUrl: response.avatarUrl,
      };

      localStorage.setItem(LOGGED_IN_USER_KEY, JSON.stringify(user));
      
      // Update User Cache
      const cacheStr = localStorage.getItem(USER_CACHE_KEY);
      const cache = cacheStr ? JSON.parse(cacheStr) : {};
      cache[user.id] = user;
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(cache));

      onAuthSuccess(user);

    } catch (err: any) {
      console.error(err);
      if (err.response) {
        if (err.response.status === 401) setError("Invalid credentials.");
        else if (err.response.status === 409) setError("Mobile number already registered.");
        else setError("An error occurred. Please try again.");
      } else {
        setError("Network error. Is the backend running?");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="text-center">
          <h2 className="mt-6 text-3xl font-extrabold text-gray-900 tracking-tight">Kapsel</h2>
          <p className="mt-2 text-sm text-gray-600">
            {isLogin ? 'Sign in to continue' : 'Create a secure account'}
          </p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            {!isLogin && (
              <Input
                label="Display Name"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                placeholder="Alice"
                required
              />
            )}
            <Input
              label="Mobile Number"
              name="mobileNumber"
              value={formData.mobileNumber}
              onChange={handleChange}
              placeholder="9990001111"
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" isLoading={isLoading}>
            {isLogin ? 'Sign In' : 'Create Account'}
          </Button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => { setIsLogin(!isLogin); setError(null); }}
            className="text-sm font-medium text-kapsel-secondary hover:text-kapsel-primary transition-colors"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
};