// frontend/src/services/searchApi.ts

import axios, { AxiosRequestConfig } from 'axios';
import { getAuthToken } from '@/lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle response errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export interface SearchQuery {
  query: string;
  language?: 'ar' | 'en' | 'de';
  limit?: number;
  offset?: number;
  filters?: SearchFilters;
  includeAnswer?: boolean;
  includeMetadata?: boolean;
  stream?: boolean;
}

export interface SearchFilters {
  departmentId?: string;
  warehouseId?: string;
  documentType?: string;
  language?: string;
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  categories?: string[];
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  documentId: string;
  documentTitle?: string;
  pageNumber?: number;
  metadata?: any;
  highlights?: string[];
  source?: {
    type: string;
    url?: string;
    updatedAt: string;
  };
}

export interface SearchResponse {
  success: boolean;
  data: {
    query: string;
    results: SearchResult[];
    totalCount: number;
    executionTime: number;
    filters: SearchFilters;
    suggestions?: string[];
    answer?: AIAnswer;
  };
}

export interface AIAnswer {
  text: string;
  confidence: number;
  sources: Array<{
    id: string;
    title: string;
    score: number;
  }>;
  relatedQuestions?: string[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
}

export interface AnswerRequest {
  query: string;
  context?: string;
  language?: 'ar' | 'en' | 'de';
  type?: 'qa' | 'summary' | 'explanation' | 'troubleshooting' | 'safety';
  conversationId?: string;
  stream?: boolean;
}

export interface FeedbackRequest {
  searchId: string;
  resultId?: string | null;
  rating: 'helpful' | 'not_helpful';
  comment?: string;
}

class SearchApiService {
  /**
   * Perform semantic search
   */
  async search(
    query: string,
    options?: Partial<SearchQuery>,
    signal?: AbortSignal
  ): Promise<SearchResponse['data']> {
    const { data } = await apiClient.post<SearchResponse>(
      '/search',
      {
        query,
        ...options,
      },
      { signal }
    );
    return data.data;
  }

  /**
   * Advanced search with multiple queries
   */
  async advancedSearch(
    queries: Array<{ text: string; filters?: SearchFilters; limit?: number }>,
    strategy: 'best' | 'average' | 'all' = 'best',
    combineResults: boolean = true
  ): Promise<any> {
    const { data } = await apiClient.post('/search/advanced', {
      queries,
      strategy,
      combineResults,
    });
    return data.data;
  }

  /**
   * Search within a specific document
   */
  async searchInDocument(
    documentId: string,
    query: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    const { data } = await apiClient.post(`/search/document/${documentId}`, {
      query,
      limit,
    });
    return data.data;
  }

  /**
   * Find similar documents
   */
  async findSimilarDocuments(
    documentId: string,
    limit: number = 5
  ): Promise<any[]> {
    const { data } = await apiClient.get(`/search/similar/${documentId}`, {
      params: { limit },
    });
    return data.data;
  }

  /**
   * Generate AI-powered answer
   */
  async generateAIAnswer(
    query: string,
    options?: Partial<AnswerRequest>
  ): Promise<AIAnswer> {
    const { data } = await apiClient.post('/search/answer', {
      query,
      ...options,
    });
    return data.data;
  }

  /**
   * Stream AI answer using Server-Sent Events
   */
  async streamAIAnswer(
    query: string,
    options: Partial<AnswerRequest>,
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const token = getAuthToken();
      const eventSource = new EventSource(
        `${API_BASE_URL}/search/answer?token=${token}&query=${encodeURIComponent(query)}&stream=true`
      );

      eventSource.onmessage = (event) => {
        if (event.data === '[DONE]') {
          eventSource.close();
          onComplete();
        } else {
          const data = JSON.parse(event.data);
          onChunk(data.content);
        }
      };

      eventSource.onerror = (error) => {
        eventSource.close();
        onError(new Error('Stream connection failed'));
      };
    } catch (error: any) {
      onError(error);
    }
  }

  /**
   * Get autocomplete suggestions
   */
  async getSuggestions(query: string, limit: number = 5): Promise<string[]> {
    if (query.length < 2) return [];

    const { data } = await apiClient.get('/search/suggestions', {
      params: { q: query, limit },
    });
    return data.data;
  }

  /**
   * Get user's search history
   */
  async getSearchHistory(limit: number = 20, offset: number = 0): Promise<any[]> {
    const { data } = await apiClient.get('/search/history', {
      params: { limit, offset },
    });
    return data.data;
  }

  /**
   * Submit feedback on search results
   */
  async submitFeedback(feedback: FeedbackRequest): Promise<void> {
    await apiClient.post('/search/feedback', feedback);
  }

  /**
   * Get trending searches
   */
  async getTrendingSearches(): Promise<Array<{ query: string; count: number }>> {
    const { data } = await apiClient.get('/search/trending');
    return data.data;
  }

  /**
   * Process voice search
   */
  async processVoiceSearch(
    audioBlob: Blob,
    language: 'ar' | 'en' | 'de' = 'en'
  ): Promise<{ transcript: string; confidence: number }> {
    const formData = new FormData();
    formData.append('audio', audioBlob);
    formData.append('language', language);

    const { data } = await apiClient.post('/search/voice', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data.data;
  }

  /**
   * Get department-specific popular searches
   */
  async getDepartmentSearches(departmentId: string): Promise<{
    popular: string[];
    recent: string[];
    recommended: string[];
  }> {
    const { data } = await apiClient.get(`/search/departments/${departmentId}`);
    return data.data;
  }

  /**
   * Clear search cache (admin only)
   */
  async clearCache(pattern?: string): Promise<void> {
    await apiClient.delete('/search/cache', {
      params: pattern ? { pattern } : undefined,
    });
  }

  /**
   * Get search analytics (admin/supervisor)
   */
  async getAnalytics(days: number = 7): Promise<any> {
    const { data } = await apiClient.get('/search/analytics', {
      params: { days },
    });
    return data.data;
  }

  /**
   * Export search results
   */
  async exportResults(
    query: string,
    format: 'csv' | 'xlsx' | 'pdf',
    filters?: SearchFilters
  ): Promise<Blob> {
    const { data } = await apiClient.post(
      '/search/export',
      { query, format, filters },
      { responseType: 'blob' }
    );
    return data;
  }

  /**
   * Batch search for multiple queries
   */
  async batchSearch(
    queries: string[],
    options?: Partial<SearchQuery>
  ): Promise<Map<string, SearchResponse['data']>> {
    const results = new Map();
    
    // Process in parallel with concurrency limit
    const concurrency = 3;
    for (let i = 0; i < queries.length; i += concurrency) {
      const batch = queries.slice(i, i + concurrency);
      const promises = batch.map(q => this.search(q, options));
      const batchResults = await Promise.all(promises);
      
      batch.forEach((query, index) => {
        results.set(query, batchResults[index]);
      });
    }
    
    return results;
  }

  /**
   * Get search performance metrics
   */
  async getPerformanceMetrics(): Promise<{
    avgResponseTime: number;
    cacheHitRate: number;
    searchesPerMinute: number;
    errorRate: number;
  }> {
    const { data } = await apiClient.get('/search/metrics');
    return data.data;
  }
}

// Create singleton instance
export const searchApi = new SearchApiService();

// Export types
export type { SearchApiService };