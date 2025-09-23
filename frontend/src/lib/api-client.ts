// C:\Dev\Git\AIwmsa\frontend\src\lib\api-client.ts
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import toast from 'react-hot-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Token management
export const tokenManager = {
  getAccessToken: () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('access_token');
    }
    return null;
  },
  
  getRefreshToken: () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('refresh_token');
    }
    return null;
  },
  
  setTokens: (accessToken: string, refreshToken: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);
    }
  },
  
  clearTokens: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  },
};

// Request interceptor
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = tokenManager.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    // Handle 401 errors (Unauthorized)
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        }).catch((err) => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = tokenManager.getRefreshToken();

      if (!refreshToken) {
        tokenManager.clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;
        tokenManager.setTokens(accessToken, newRefreshToken);
        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        tokenManager.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle other errors
    if (error.response) {
      const errorMessage = (error.response.data as any)?.message || 'An error occurred';
      
      // Don't show toast for validation errors (they're handled in forms)
      if (error.response.status !== 400) {
        toast.error(errorMessage);
      }
    } else if (error.request) {
      toast.error('Network error. Please check your connection.');
    } else {
      toast.error('An unexpected error occurred.');
    }

    return Promise.reject(error);
  }
);

export default apiClient;

// API endpoints
export const api = {
  // Auth
  auth: {
    login: (data: { email: string; password: string }) =>
      apiClient.post('/auth/login', data),
    logout: () => apiClient.post('/auth/logout'),
    refresh: (refreshToken: string) =>
      apiClient.post('/auth/refresh', { refreshToken }),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
      apiClient.post('/auth/change-password', data),
    profile: () => apiClient.get('/auth/profile'),
  },

  // Users
  users: {
    list: (params?: any) => apiClient.get('/users', { params }),
    get: (id: string) => apiClient.get(`/users/${id}`),
    create: (data: any) => apiClient.post('/users', data),
    update: (id: string, data: any) => apiClient.patch(`/users/${id}`, data),
    delete: (id: string) => apiClient.delete(`/users/${id}`),
    resetPassword: (id: string, newPassword: string) =>
      apiClient.post(`/users/${id}/reset-password`, { newPassword }),
    stats: () => apiClient.get('/users/stats/overview'),
  },

  // Warehouses
  warehouses: {
    list: (params?: any) => apiClient.get('/warehouses', { params }),
    get: (id: string) => apiClient.get(`/warehouses/${id}`),
    create: (data: any) => apiClient.post('/warehouses', data),
    update: (id: string, data: any) => apiClient.patch(`/warehouses/${id}`, data),
    delete: (id: string) => apiClient.delete(`/warehouses/${id}`),
    stats: (id: string) => apiClient.get(`/warehouses/${id}/stats`),
    activity: (id: string, params?: any) =>
      apiClient.get(`/warehouses/${id}/activity`, { params }),
  },

  // Documents (placeholder for future)
  documents: {
    upload: (formData: FormData) =>
      apiClient.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    list: (params?: any) => apiClient.get('/documents', { params }),
    get: (id: string) => apiClient.get(`/documents/${id}`),
    delete: (id: string) => apiClient.delete(`/documents/${id}`),
  },

  // Search (placeholder for future)
  search: {
    query: (data: { query: string; filters?: any }) =>
      apiClient.post('/search/query', data),
    suggestions: (query: string) =>
      apiClient.get('/search/suggestions', { params: { query } }),
  },
};