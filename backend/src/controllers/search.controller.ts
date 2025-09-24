// backend/src/controllers/search.controller.ts

import { Request, Response, NextFunction } from 'express';
import { SemanticSearchService } from '../services/search/semantic-search.service';
import { OpenAIService } from '../services/ai/openai.service';
import { PromptService } from '../services/ai/prompt.service';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error';
import { validationResult } from 'express-validator';

interface SearchRequest {
  query: string;
  language?: 'ar' | 'en' | 'de';
  limit?: number;
  offset?: number;
  filters?: {
    departmentId?: string;
    warehouseId?: string;
    documentType?: string;
    dateFrom?: string;
    dateTo?: string;
    tags?: string[];
    categories?: string[];
  };
  includeAnswer?: boolean;
  includeMetadata?: boolean;
  stream?: boolean;
}

interface AnswerRequest {
  query: string;
  context?: string;
  language?: 'ar' | 'en' | 'de';
  type?: 'qa' | 'summary' | 'explanation' | 'troubleshooting' | 'safety';
  conversationId?: string;
  stream?: boolean;
}

export class SearchController {
  private searchService: SemanticSearchService;
  private openaiService: OpenAIService;
  private promptService: PromptService;

  constructor() {
    this.searchService = new SemanticSearchService();
    this.openaiService = new OpenAIService();
    this.promptService = new PromptService();
  }

  /**
   * Search endpoint
   * POST /api/search
   */
  search = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const searchRequest = req.body as SearchRequest;
      const userId = (req as any).user?.id;

      logger.info(`Search request from user ${userId}: ${searchRequest.query}`);

      // Perform search
      const searchResults = await this.searchService.search(
        searchRequest.query,
        {
          limit: searchRequest.limit || 10,
          offset: searchRequest.offset || 0,
          filters: searchRequest.filters ? {
            ...searchRequest.filters,
            dateFrom: searchRequest.filters.dateFrom ? 
              new Date(searchRequest.filters.dateFrom) : undefined,
            dateTo: searchRequest.filters.dateTo ? 
              new Date(searchRequest.filters.dateTo) : undefined,
          } : undefined,
          includeMetadata: searchRequest.includeMetadata,
          rerank: true
        }
      );

      // Generate AI answer if requested
      let aiAnswer = null;
      if (searchRequest.includeAnswer && searchResults.results.length > 0) {
        aiAnswer = await this.generateAnswer(
          searchRequest.query,
          searchResults.results,
          searchRequest.language || 'en'
        );
      }

      // Log search for analytics
      await this.logSearch(userId, searchRequest, searchResults.totalCount);

      res.json({
        success: true,
        data: {
          ...searchResults,
          answer: aiAnswer
        }
      });
    } catch (error) {
      logger.error('Search failed:', error);
      next(new AppError('Search failed', 500));
    }
  };

  /**
   * Advanced search with multiple strategies
   * POST /api/search/advanced
   */
  advancedSearch = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { 
        queries, 
        strategy = 'best', 
        combineResults = true 
      } = req.body;

      if (!Array.isArray(queries) || queries.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Queries array is required'
        });
      }

      const results = [];
      
      for (const query of queries) {
        const searchResult = await this.searchService.search(query.text, {
          limit: query.limit || 5,
          filters: query.filters,
          rerank: true
        });
        results.push(searchResult);
      }

      // Combine or keep separate based on request
      let finalResults;
      if (combineResults) {
        finalResults = this.combineSearchResults(results, strategy);
      } else {
        finalResults = results;
      }

      res.json({
        success: true,
        data: finalResults
      });
    } catch (error) {
      logger.error('Advanced search failed:', error);
      next(new AppError('Advanced search failed', 500));
    }
  };

  /**
   * Search within a specific document
   * POST /api/search/document/:documentId
   */
  searchInDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;
      const { query, limit = 5 } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query is required'
        });
      }

      const results = await this.searchService.searchByDocument(
        documentId,
        query,
        limit
      );

      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      logger.error('Document search failed:', error);
      next(new AppError('Document search failed', 500));
    }
  };

  /**
   * Find similar documents
   * GET /api/search/similar/:documentId
   */
  findSimilar = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { documentId } = req.params;
      const { limit = 5 } = req.query;

      const similar = await this.searchService.findSimilarDocuments(
        documentId,
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: similar
      });
    } catch (error) {
      logger.error('Similar documents search failed:', error);
      next(new AppError('Similar documents search failed', 500));
    }
  };

  /**
   * Generate AI answer
   * POST /api/search/answer
   */
  generateAIAnswer = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const answerRequest = req.body as AnswerRequest;
      const userId = (req as any).user?.id;

      // Search for context if not provided
      let searchResults = [];
      if (!answerRequest.context) {
        const search = await this.searchService.search(answerRequest.query, {
          limit: 5,
          rerank: true
        });
        searchResults = search.results;
      }

      // Build prompt
      const promptContext = {
        language: answerRequest.language || 'en',
        type: answerRequest.type || 'qa',
        userRole: (req as any).user?.role,
        documentContext: answerRequest.context
      };

      const messages = this.promptService.buildMessages(
        answerRequest.query,
        promptContext,
        searchResults
      );

      // Generate answer
      if (answerRequest.stream) {
        // Set up SSE for streaming
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        const stream = this.openaiService.streamCompletion(messages, {
          temperature: 0.7,
          maxTokens: 1000
        });

        for await (const chunk of stream) {
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        const { content, usage } = await this.openaiService.generateCompletion(messages, {
          temperature: 0.7,
          maxTokens: 1000
        });

        // Generate confidence score
        const confidence = this.calculateConfidence(content, searchResults);

        // Generate related questions
        const relatedQuestions = await this.generateRelatedQuestions(
          answerRequest.query,
          content,
          answerRequest.language || 'en'
        );

        res.json({
          success: true,
          data: {
            answer: content,
            confidence,
            sources: searchResults.map(r => ({
              id: r.id,
              title: r.documentTitle,
              score: r.score
            })),
            relatedQuestions,
            usage
          }
        });
      }
    } catch (error) {
      logger.error('Answer generation failed:', error);
      next(new AppError('Answer generation failed', 500));
    }
  };

  /**
   * Autocomplete suggestions
   * GET /api/search/suggestions
   */
  getSuggestions = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { q, limit = 5 } = req.query;

      if (!q || (q as string).length < 2) {
        return res.json({
          success: true,
          data: []
        });
      }

      // Get suggestions from search history and common queries
      const suggestions = await this.getAutocompleteSuggestions(
        q as string,
        parseInt(limit as string)
      );

      res.json({
        success: true,
        data: suggestions
      });
    } catch (error) {
      logger.error('Suggestions failed:', error);
      next(new AppError('Failed to get suggestions', 500));
    }
  };

  /**
   * Search history for user
   * GET /api/search/history
   */
  getSearchHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).user?.id;
      const { limit = 20, offset = 0 } = req.query;

      const history = await this.getUserSearchHistory(
        userId,
        parseInt(limit as string),
        parseInt(offset as string)
      );

      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      logger.error('Failed to get search history:', error);
      next(new AppError('Failed to get search history', 500));
    }
  };

  /**
   * Clear search cache
   * DELETE /api/search/cache
   */
  clearCache = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { pattern } = req.query;
      
      await this.searchService.clearCache(pattern as string);

      res.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    } catch (error) {
      logger.error('Failed to clear cache:', error);
      next(new AppError('Failed to clear cache', 500));
    }
  };

  /**
   * Get search analytics
   * GET /api/search/analytics
   */
  getAnalytics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { days = 7 } = req.query;

      const stats = await this.searchService.getSearchStats(
        parseInt(days as string)
      );

      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      logger.error('Failed to get analytics:', error);
      next(new AppError('Failed to get analytics', 500));
    }
  };

  // Private helper methods

  private async generateAnswer(
    query: string,
    searchResults: any[],
    language: 'ar' | 'en' | 'de'
  ): Promise<any> {
    try {
      const promptContext = {
        language,
        type: 'qa' as const,
      };

      const messages = this.promptService.buildMessages(
        query,
        promptContext,
        searchResults
      );

      const { content } = await this.openaiService.generateCompletion(messages, {
        temperature: 0.7,
        maxTokens: 500
      });

      return {
        text: content,
        sources: searchResults.slice(0, 3).map(r => ({
          id: r.id,
          title: r.documentTitle,
          score: r.score
        }))
      };
    } catch (error) {
      logger.error('Failed to generate answer:', error);
      return null;
    }
  }

  private calculateConfidence(answer: string, sources: any[]): number {
    // Simple confidence calculation based on sources and answer length
    let confidence = 0.5;

    if (sources.length > 0) {
      // Average source scores
      const avgScore = sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
      confidence = avgScore;
    }

    // Adjust based on answer characteristics
    if (answer.length < 50) confidence *= 0.8;
    if (answer.includes('I\'m not sure') || answer.includes('unclear')) confidence *= 0.7;
    if (answer.includes('According to') || answer.includes('Based on')) confidence *= 1.1;

    return Math.min(Math.max(confidence, 0), 1);
  }

  private async generateRelatedQuestions(
    query: string,
    answer: string,
    language: 'ar' | 'en' | 'de'
  ): Promise<string[]> {
    try {
      const messages = this.promptService.buildRelatedQuestionsPrompt(
        query,
        answer,
        language
      );

      const { content } = await this.openaiService.generateCompletion(messages, {
        temperature: 0.8,
        maxTokens: 200
      });

      return JSON.parse(content);
    } catch (error) {
      logger.error('Failed to generate related questions:', error);
      return [];
    }
  }

  private combineSearchResults(results: any[], strategy: string): any {
    // Combine multiple search results based on strategy
    const combined = {
      query: 'Combined search',
      results: [] as any[],
      totalCount: 0,
      executionTime: 0
    };

    const allResults = new Map();

    for (const searchResult of results) {
      combined.executionTime = Math.max(combined.executionTime, searchResult.executionTime);
      
      for (const result of searchResult.results) {
        const existing = allResults.get(result.id);
        if (existing) {
          // Update score based on strategy
          if (strategy === 'best') {
            existing.score = Math.max(existing.score, result.score);
          } else if (strategy === 'average') {
            existing.score = (existing.score + result.score) / 2;
          }
        } else {
          allResults.set(result.id, result);
        }
      }
    }

    combined.results = Array.from(allResults.values())
      .sort((a, b) => b.score - a.score);
    combined.totalCount = combined.results.length;

    return combined;
  }

  private async logSearch(userId: string, request: SearchRequest, resultCount: number): Promise<void> {
    // Log search for analytics
    try {
      // Implementation would log to database
      logger.info(`Search logged: User ${userId}, Query: ${request.query}, Results: ${resultCount}`);
    } catch (error) {
      logger.warn('Failed to log search:', error);
    }
  }

  private async getAutocompleteSuggestions(query: string, limit: number): Promise<string[]> {
    // Get autocomplete suggestions from history and common queries
    // This would query the database for similar previous searches
    return [
      `${query} procedure`,
      `${query} safety`,
      `${query} troubleshooting`,
      `how to ${query}`,
      `${query} error`
    ].slice(0, limit);
  }

  private async getUserSearchHistory(userId: string, limit: number, offset: number): Promise<any[]> {
    // Get user's search history from database
    // This would query the search_logs table
    return [];
  }
}