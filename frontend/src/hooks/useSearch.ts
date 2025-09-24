// frontend/src/hooks/useSearch.ts

import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchApi } from '@/services/searchApi';
import { useDebounce } from '@/hooks/useDebounce';
import { toast } from 'sonner';

interface SearchOptions {
  filters?: any;
  language?: 'ar' | 'en' | 'de';
  includeAnswer?: boolean;
  limit?: number;
  offset?: number;
}

interface SearchResult {
  id: string;
  content: string;
  score: number;
  documentId: string;
  documentTitle?: string;
  highlights?: string[];
  source?: {
    type: string;
    url?: string;
    updatedAt: Date;
  };
}

interface AIAnswer {
  text: string;
  confidence: number;
  sources: any[];
  relatedQuestions?: string[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
}

interface SearchState {
  query: string;
  results: SearchResult[];
  aiAnswer: AIAnswer | null;
  isLoading: boolean;
  error: string | null;
  totalCount: number;
  executionTime: number;
  suggestions: string[];
  hasMore: boolean;
}

export function useSearch() {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const [state, setState] = useState<SearchState>({
    query: '',
    results: [],
    aiAnswer: null,
    isLoading: false,
    error: null,
    totalCount: 0,
    executionTime: 0,
    suggestions: [],
    hasMore: false
  });

  const [searchOptions, setSearchOptions] = useState<SearchOptions>({
    limit: 20,
    offset: 0,
    includeAnswer: true,
    language: 'en'
  });

  // Debounced query for suggestions
  const debouncedQuery = useDebounce(state.query, 300);

  // Get search suggestions
  const { data: suggestionsData } = useQuery({
    queryKey: ['suggestions', debouncedQuery],
    queryFn: () => searchApi.getSuggestions(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Get search history
  const { data: searchHistory } = useQuery({
    queryKey: ['searchHistory'],
    queryFn: () => searchApi.getSearchHistory(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Main search mutation
  const searchMutation = useMutation({
    mutationFn: async ({ query, options }: { query: string; options?: SearchOptions }) => {
      // Cancel previous request if exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      return searchApi.search(query, {
        ...searchOptions,
        ...options
      }, abortControllerRef.current.signal);
    },
    onSuccess: (data) => {
      setState(prev => ({
        ...prev,
        results: data.results,
        aiAnswer: data.answer,
        totalCount: data.totalCount,
        executionTime: data.executionTime,
        isLoading: false,
        error: null,
        hasMore: data.totalCount > (searchOptions.offset || 0) + data.results.length
      }));

      // Cache the results
      queryClient.setQueryData(['searchResults', state.query], data);
    },
    onError: (error: any) => {
      if (error.name !== 'AbortError') {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: error.message || 'Search failed'
        }));
        toast.error('Search failed', {
          description: error.message
        });
      }
    }
  });

  // Search function
  const search = useCallback(async (
    query: string,
    options?: SearchOptions
  ) => {
    if (!query?.trim()) {
      setState(prev => ({
        ...prev,
        results: [],
        aiAnswer: null,
        error: 'Query is required'
      }));
      return;
    }

    setState(prev => ({
      ...prev,
      query,
      isLoading: true,
      error: null
    }));

    const mergedOptions = { ...searchOptions, ...options };
    setSearchOptions(mergedOptions);

    await searchMutation.mutateAsync({ query, options: mergedOptions });
  }, [searchOptions, searchMutation]);

  // Load more results
  const loadMore = useCallback(async () => {
    if (!state.query || state.isLoading || !state.hasMore) return;

    const newOffset = (searchOptions.offset || 0) + (searchOptions.limit || 20);
    
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const data = await searchApi.search(state.query, {
        ...searchOptions,
        offset: newOffset,
        includeAnswer: false // Don't regenerate answer for pagination
      });

      setState(prev => ({
        ...prev,
        results: [...prev.results, ...data.results],
        isLoading: false,
        hasMore: data.totalCount > newOffset + data.results.length
      }));

      setSearchOptions(prev => ({ ...prev, offset: newOffset }));
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
    }
  }, [state.query, state.isLoading, state.hasMore, searchOptions]);

  // Clear results
  const clearResults = useCallback(() => {
    setState({
      query: '',
      results: [],
      aiAnswer: null,
      isLoading: false,
      error: null,
      totalCount: 0,
      executionTime: 0,
      suggestions: [],
      hasMore: false
    });
    setSearchOptions({
      limit: 20,
      offset: 0,
      includeAnswer: true,
      language: 'en'
    });
  }, []);

  // Search within document
  const searchInDocument = useCallback(async (
    documentId: string,
    query: string
  ) => {
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const results = await searchApi.searchInDocument(documentId, query);
      
      setState(prev => ({
        ...prev,
        results,
        isLoading: false,
        totalCount: results.length
      }));
      
      return results;
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
      throw error;
    }
  }, []);

  // Find similar documents
  const findSimilar = useCallback(async (documentId: string) => {
    try {
      const similar = await searchApi.findSimilarDocuments(documentId);
      return similar;
    } catch (error) {
      console.error('Failed to find similar documents:', error);
      return [];
    }
  }, []);

  // Generate AI answer
  const generateAnswer = useCallback(async (
    query: string,
    options?: {
      context?: string;
      type?: 'qa' | 'summary' | 'explanation' | 'troubleshooting' | 'safety';
      language?: 'ar' | 'en' | 'de';
      stream?: boolean;
    }
  ) => {
    try {
      setState(prev => ({ ...prev, isLoading: true }));
      
      const answer = await searchApi.generateAIAnswer(query, options);
      
      setState(prev => ({
        ...prev,
        aiAnswer: answer,
        isLoading: false
      }));
      
      return answer;
    } catch (error: any) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
      throw error;
    }
  }, []);

  // Submit feedback
  const submitFeedback = useCallback(async (
    searchId: string,
    resultId: string | null,
    rating: 'helpful' | 'not_helpful',
    comment?: string
  ) => {
    try {
      await searchApi.submitFeedback({
        searchId,
        resultId,
        rating,
        comment
      });
      
      toast.success('Thank you for your feedback!');
    } catch (error) {
      toast.error('Failed to submit feedback');
    }
  }, []);

  // Update suggestions when debounced query changes
  useEffect(() => {
    if (suggestionsData) {
      setState(prev => ({
        ...prev,
        suggestions: suggestionsData
      }));
    }
  }, [suggestionsData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    // State
    query: state.query,
    results: state.results,
    aiAnswer: state.aiAnswer,
    isLoading: state.isLoading,
    error: state.error,
    totalCount: state.totalCount,
    executionTime: state.executionTime,
    suggestions: state.suggestions,
    hasMore: state.hasMore,
    searchHistory,
    
    // Actions
    search,
    loadMore,
    clearResults,
    searchInDocument,
    findSimilar,
    generateAnswer,
    submitFeedback,
    setQuery: (query: string) => setState(prev => ({ ...prev, query })),
    setOptions: setSearchOptions
  };
}

// Hook for voice search
export function useVoiceSearch() {
  const { search } = useSearch();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback((language: string = 'en-US') => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Speech recognition not supported in your browser');
      return;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript('');
    };

    recognition.onresult = (event: any) => {
      const current = event.resultIndex;
      const transcript = event.results[current][0].transcript;
      setTranscript(transcript);

      if (event.results[current].isFinal) {
        search(transcript);
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      toast.error('Speech recognition failed');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
  }, [search]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, []);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported: ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window)
  };
}