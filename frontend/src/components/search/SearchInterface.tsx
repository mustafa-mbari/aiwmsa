// frontend/src/components/search/SearchInterface.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Mic, MicOff, Filter, Loader2, X, ChevronDown, FileText, Clock, Tag } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { SearchResults } from './SearchResults';
import { SearchFilters } from './SearchFilters';
import { AutoSuggestions } from './AutoSuggestions';
import { AIResponse } from './AIResponse';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SearchInterfaceProps {
  className?: string;
  departmentId?: string;
  warehouseId?: string;
  showFilters?: boolean;
  showAIAnswer?: boolean;
  onResultSelect?: (result: any) => void;
}

export function SearchInterface({
  className,
  departmentId,
  warehouseId,
  showFilters = true,
  showAIAnswer = true,
  onResultSelect
}: SearchInterfaceProps) {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState<'ar' | 'en' | 'de'>('en');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'all' | 'documents' | 'answers'>('all');
  const [filters, setFilters] = useState<any>({
    departmentId,
    warehouseId
  });
  
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const {
    results,
    aiAnswer,
    isLoading,
    error,
    search,
    clearResults,
    suggestions,
    searchHistory
  } = useSearch();

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported: voiceSupported
  } = useVoiceInput({
    language: language === 'ar' ? 'ar-SA' : language === 'de' ? 'de-DE' : 'en-US',
    continuous: false
  });

  // Load recent searches
  useEffect(() => {
    const saved = localStorage.getItem('recentSearches');
    if (saved) {
      setRecentSearches(JSON.parse(saved));
    }
  }, []);

  // Update query when voice transcript changes
  useEffect(() => {
    if (transcript) {
      setQuery(transcript);
      handleSearch(transcript);
    }
  }, [transcript]);

  // Handle search
  const handleSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;

    // Save to recent searches
    const recent = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5);
    setRecentSearches(recent);
    localStorage.setItem('recentSearches', JSON.stringify(recent));

    // Perform search
    await search(q, {
      filters,
      language,
      includeAnswer: showAIAnswer,
      limit: 20
    });

    setShowSuggestions(false);
  }, [query, filters, language, showAIAnswer, search, recentSearches]);

  // Handle voice input toggle
  const toggleVoiceInput = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: any) => {
    setFilters({ ...filters, ...newFilters });
  }, [filters]);

  // Clear search
  const handleClear = useCallback(() => {
    setQuery('');
    clearResults();
    searchInputRef.current?.focus();
  }, [clearResults]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + K to focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Escape to clear
      if (e.key === 'Escape' && query) {
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [query, handleClear]);

  return (
    <div className={cn('w-full max-w-6xl mx-auto', className)}>
      {/* Search Header */}
      <Card className="p-6 mb-6">
        <div className="space-y-4">
          {/* Language Selector */}
          <div className="flex justify-end gap-2 mb-4">
            <Button
              variant={language === 'en' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('en')}
            >
              EN
            </Button>
            <Button
              variant={language === 'ar' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('ar')}
            >
              عربي
            </Button>
            <Button
              variant={language === 'de' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLanguage('de')}
            >
              DE
            </Button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleSearch();
                    }
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder={
                    language === 'ar' 
                      ? 'ابحث عن المستندات والإجراءات...'
                      : language === 'de'
                      ? 'Dokumente und Verfahren suchen...'
                      : 'Search for documents, procedures, error codes...'
                  }
                  className="pl-10 pr-10 h-12 text-lg"
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                />
                {query && (
                  <button
                    onClick={handleClear}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>

              {/* Voice Input Button */}
              {voiceSupported && (
                <Button
                  variant={isListening ? 'destructive' : 'outline'}
                  size="lg"
                  onClick={toggleVoiceInput}
                  className="h-12 px-4"
                >
                  {isListening ? (
                    <>
                      <MicOff className="h-5 w-5 mr-2" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Mic className="h-5 w-5 mr-2" />
                      Speak
                    </>
                  )}
                </Button>
              )}

              {/* Search Button */}
              <Button
                onClick={() => handleSearch()}
                disabled={!query.trim() || isLoading}
                className="h-12 px-6"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Search'
                )}
              </Button>

              {/* Filter Toggle */}
              {showFilters && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="h-12"
                >
                  <Filter className="h-5 w-5 mr-2" />
                  Filters
                  <ChevronDown className={cn(
                    "h-4 w-4 ml-2 transition-transform",
                    showAdvancedFilters && "rotate-180"
                  )} />
                </Button>
              )}
            </div>

            {/* Auto Suggestions */}
            {showSuggestions && (query || recentSearches.length > 0) && (
              <AutoSuggestions
                query={query}
                suggestions={suggestions}
                recentSearches={recentSearches}
                onSelect={(suggestion) => {
                  setQuery(suggestion);
                  handleSearch(suggestion);
                  setShowSuggestions(false);
                }}
                onClose={() => setShowSuggestions(false)}
              />
            )}
          </div>

          {/* Voice Transcript */}
          {isListening && transcript && (
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg animate-pulse">
              <Mic className="h-5 w-5 text-blue-600" />
              <span className="text-blue-800">{transcript}</span>
            </div>
          )}

          {/* Advanced Filters */}
          {showAdvancedFilters && (
            <SearchFilters
              filters={filters}
              onChange={handleFilterChange}
              onReset={() => setFilters({ departmentId, warehouseId })}
            />
          )}

          {/* Active Filters Display */}
          {Object.keys(filters).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {filters.documentType && (
                <Badge variant="secondary">
                  <FileText className="h-3 w-3 mr-1" />
                  {filters.documentType}
                </Badge>
              )}
              {filters.dateFrom && (
                <Badge variant="secondary">
                  <Clock className="h-3 w-3 mr-1" />
                  From: {new Date(filters.dateFrom).toLocaleDateString()}
                </Badge>
              )}
              {filters.dateTo && (
                <Badge variant="secondary">
                  <Clock className="h-3 w-3 mr-1" />
                  To: {new Date(filters.dateTo).toLocaleDateString()}
                </Badge>
              )}
              {filters.tags?.map((tag: string) => (
                <Badge key={tag} variant="secondary">
                  <Tag className="h-3 w-3 mr-1" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50">
          <p className="text-red-800">{error}</p>
        </Card>
      )}

      {/* Results Section */}
      {(results.length > 0 || aiAnswer) && (
        <Tabs value={selectedTab} onValueChange={(v: any) => setSelectedTab(v)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all">
              All Results
              {results.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {results.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            {showAIAnswer && (
              <TabsTrigger value="answers">AI Answer</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <div className="space-y-6">
              {/* AI Answer Summary */}
              {showAIAnswer && aiAnswer && (
                <Card className="p-6 border-blue-200 bg-blue-50/50">
                  <h3 className="font-semibold text-lg mb-3 flex items-center">
                    <span className="mr-2">🤖</span>
                    Quick Answer
                  </h3>
                  <div className="prose max-w-none">
                    <p>{aiAnswer.text}</p>
                    {aiAnswer.sources && aiAnswer.sources.length > 0 && (
                      <div className="mt-3 text-sm text-gray-600">
                        Sources: {aiAnswer.sources.map((s: any, i: number) => (
                          <span key={s.id}>
                            {s.title}
                            {i < aiAnswer.sources.length - 1 && ', '}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* Search Results */}
              <SearchResults
                results={results}
                query={query}
                isLoading={isLoading}
                onResultClick={onResultSelect}
              />
            </div>
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <SearchResults
              results={results.filter((r: any) => r.source?.type === 'document')}
              query={query}
              isLoading={isLoading}
              onResultClick={onResultSelect}
            />
          </TabsContent>

          {showAIAnswer && (
            <TabsContent value="answers" className="mt-4">
              {aiAnswer ? (
                <AIResponse
                  response={aiAnswer}
                  query={query}
                  onFeedback={(feedback) => {
                    console.log('Feedback:', feedback);
                  }}
                />
              ) : (
                <Card className="p-12 text-center">
                  <p className="text-gray-500">No AI answer generated yet</p>
                </Card>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Empty State */}
      {!isLoading && !results.length && !error && query && (
        <Card className="p-12 text-center">
          <Search className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No results found</h3>
          <p className="text-gray-600 mb-4">
            Try adjusting your search terms or filters
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              onClick={() => setShowAdvancedFilters(true)}
            >
              <Filter className="h-4 w-4 mr-2" />
              Adjust Filters
            </Button>
            <Button
              variant="outline"
              onClick={handleClear}
            >
              Clear Search
            </Button>
          </div>
        </Card>
      )}

      {/* Initial State */}
      {!isLoading && !results.length && !query && (
        <Card className="p-12">
          <div className="max-w-2xl mx-auto text-center">
            <Search className="h-20 w-20 text-gray-300 mx-auto mb-6" />
            <h2 className="text-2xl font-bold mb-4">
              {language === 'ar' 
                ? 'ابحث في قاعدة المعرفة'
                : language === 'de'
                ? 'Durchsuchen Sie die Wissensdatenbank'
                : 'Search the Knowledge Base'
              }
            </h2>
            <p className="text-gray-600 mb-8">
              {language === 'ar'
                ? 'ابحث عن المستندات، والإجراءات، ورموز الأخطاء، وأدلة السلامة'
                : language === 'de'
                ? 'Suchen Sie nach Dokumenten, Verfahren, Fehlercodes und Sicherheitsrichtlinien'
                : 'Find documents, procedures, error codes, and safety guides'
              }
            </p>

            {/* Quick Search Suggestions */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                'Error E-102',
                'Forklift safety',
                'Inventory procedures',
                'Equipment maintenance'
              ].map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  onClick={() => {
                    setQuery(suggestion);
                    handleSearch(suggestion);
                  }}
                  className="text-sm"
                >
                  {suggestion}
                </Button>
              ))}
            </div>

            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-gray-600 mb-3">Recent Searches</h3>
                <div className="flex flex-wrap gap-2 justify-center">
                  {recentSearches.map((search) => (
                    <Button
                      key={search}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuery(search);
                        handleSearch(search);
                      }}
                      className="text-sm"
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      {search}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}