// C:\Dev\Git\AIwmsa\frontend\src\stores\auth-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, tokenManager } from '@/lib/api-client';
import toast from 'react-hot-toast';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'EXPERT' | 'WORKER';
  warehouseId: string;
  warehouse?: {
    id: string;
    name: string;
    code: string;
  };
  preferredLanguage: 'ar' | 'en' | 'de';
  department?: string;
  phone?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (email: string, password: string) => {
        set({ isLoading: true });
        try {
          const response = await api.auth.login({ email, password });
          const { user, accessToken, refreshToken } = response.data.data;
          
          tokenManager.setTokens(accessToken, refreshToken);
          set({ user, isAuthenticated: true });
          
          toast.success(`Welcome back, ${user.name}!`);
        } catch (error: any) {
          const message = error.response?.data?.message || 'Login failed';
          toast.error(message);
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await api.auth.logout();
        } catch (error) {
          // Continue with logout even if API call fails
          console.error('Logout API error:', error);
        } finally {
          tokenManager.clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
          toast.success('Logged out successfully');
        }
      },

      fetchProfile: async () => {
        set({ isLoading: true });
        try {
          const response = await api.auth.profile();
          set({ user: response.data.data, isAuthenticated: true });
        } catch (error) {
          console.error('Failed to fetch profile:', error);
          set({ user: null, isAuthenticated: false });
        } finally {
          set({ isLoading: false });
        }
      },

      updateProfile: async (data: Partial<User>) => {
        set({ isLoading: true });
        try {
          const userId = useAuthStore.getState().user?.id;
          if (!userId) throw new Error('User not found');
          
          const response = await api.users.update(userId, data);
          set({ user: response.data.data });
          toast.success('Profile updated successfully');
        } catch (error: any) {
          toast.error(error.response?.data?.message || 'Failed to update profile');
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      changePassword: async (currentPassword: string, newPassword: string) => {
        set({ isLoading: true });
        try {
          await api.auth.changePassword({ currentPassword, newPassword });
          toast.success('Password changed successfully');
        } catch (error: any) {
          toast.error(error.response?.data?.message || 'Failed to change password');
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      clearAuth: () => {
        tokenManager.clearTokens();
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ 
        user: state.user, 
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
);