// backend/src/services/search/semantic-search.service.ts

import { PrismaClient } from '@prisma/client';
import { OpenAIService } from '../ai/openai.service';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error';
import { redis } from '../../config/redis';

interface SearchOptions {
  limit?: number;
  offset?: number;
  threshold?: number;
  filters?: SearchFilters;
  includeMetadata?: boolean;
  rerank?: boolean;
}

interface SearchFilters {
  departmentId?: string;
  warehouseId?: string;
  documentType?: string;
  language?: string;
  dateFrom?: Date;
  dateTo?: Date;
  tags?: string[];
  categories?: string[];
}

interface SearchResult {
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
    updatedAt: Date;
  };
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalCount: number;
  executionTime: number;
  filters: SearchFilters;
  suggestions?: string[];
}

export class SemanticSearchService {
  private prisma: PrismaClient;
  private openaiService: OpenAIService;
  private readonly DEFAULT_LIMIT = 10;
  private readonly DEFAULT_THRESHOLD = 0.7;
  private readonly CACHE_TTL = 3600; // 1 hour

  constructor() {
    this.prisma = new PrismaClient();
    this.openaiService = new OpenAIService();
  }

  /**
   * Perform semantic search
   * يقوم بالبحث الدلالي
   */
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now();

    try {
      // Set defaults
      const limit = options.limit || this.DEFAULT_LIMIT;
      const offset = options.offset || 0;
      const threshold = options.threshold || this.DEFAULT_THRESHOLD;

      // Check cache
      const cacheKey = this.getCacheKey(query, options);
      const cached = await this.getCachedResults(cacheKey);
      if (cached) {
        logger.debug('Returning cached search results');
        return cached;
      }

      // Generate embedding for query
      logger.info(`Generating embedding for query: ${query}`);
      const queryEmbedding = await this.openaiService.generateEmbedding(query);

      // Build the search query
      const searchResults = await this.executeVectorSearch(
        queryEmbedding,
        limit,
        offset,
        threshold,
        options.filters
      );

      // Rerank results if requested
      let finalResults = searchResults;
      if (options.rerank && searchResults.length > 0) {
        finalResults = await this.rerankResults(query, searchResults);
      }

      // Add highlights
      finalResults = this.addHighlights(query, finalResults);

      // Get suggestions for related searches
      const suggestions = await this.generateSuggestions(query, finalResults);

      const response: SearchResponse = {
        query,
        results: finalResults,
        totalCount: finalResults.length,
        executionTime: Date.now() - startTime,
        filters: options.filters || {},
        suggestions
      };

      // Cache the results
      await this.cacheResults(cacheKey, response);

      // Log search analytics
      await this.logSearchAnalytics(query, response);

      return response;
    } catch (error) {
      logger.error('Semantic search failed:', error);
      throw new AppError('Search failed', 500);
    }
  }

  /**
   * Execute vector search in database
   * ينفذ البحث في قاعدة البيانات
   */
  private async executeVectorSearch(
    embedding: number[],
    limit: number,
    offset: number,
    threshold: number,
    filters?: SearchFilters
  ): Promise<SearchResult[]> {
    try {
      // Convert embedding to PostgreSQL vector format
      const vectorString = `[${embedding.join(',')}]`;

      // Build WHERE clause for filters
      let whereClause = 'WHERE 1=1';
      const params: any[] = [vectorString, limit, offset];
      let paramIndex = 4;

      if (filters) {
        if (filters.departmentId) {
          whereClause += ` AND d.department_id = $${paramIndex++}`;
          params.push(filters.departmentId);
        }
        if (filters.warehouseId) {
          whereClause += ` AND d.warehouse_id = $${paramIndex++}`;
          params.push(filters.warehouseId);
        }
        if (filters.documentType) {
          whereClause += ` AND d.type = $${paramIndex++}`;
          params.push(filters.documentType);
        }
        if (filters.language) {
          whereClause += ` AND d.language = $${paramIndex++}`;
          params.push(filters.language);
        }
        if (filters.dateFrom) {
          whereClause += ` AND d.created_at >= $${paramIndex++}`;
          params.push(filters.dateFrom);
        }
        if (filters.dateTo) {
          whereClause += ` AND d.created_at <= $${paramIndex++}`;
          params.push(filters.dateTo);
        }
        if (filters.categories && filters.categories.length > 0) {
          whereClause += ` AND d.category = ANY($${paramIndex++})`;
          params.push(filters.categories);
        }
      }

      // Execute the vector similarity search
      const query = `
        SELECT 
          c.id,
          c.content,
          c.chunk_index,
          c.metadata,
          d.id as document_id,
          d.title as document_title,
          d.type as document_type,
          d.url as document_url,
          d.updated_at,
          1 - (c.embedding <=> $1::vector) as similarity_score
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        ${whereClause}
          AND 1 - (c.embedding <=> $1::vector) > ${threshold}
        ORDER BY similarity_score DESC
        LIMIT $2
        OFFSET $3
      `;

      const results = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);

      // Transform results
      return results.map(row => ({
        id: row.id,
        content: row.content,
        score: parseFloat(row.similarity_score),
        documentId: row.document_id,
        documentTitle: row.document_title,
        pageNumber: row.chunk_index,
        metadata: row.metadata,
        source: {
          type: row.document_type,
          url: row.document_url,
          updatedAt: row.updated_at
        }
      }));
    } catch (error) {
      logger.error('Vector search execution failed:', error);
      throw error;
    }
  }

  /**
   * Rerank results using cross-encoder or additional scoring
   * يعيد ترتيب النتائج
   */
  private async rerankResults(
    query: string,
    results: SearchResult[]
  ): Promise<SearchResult[]> {
    try {
      // Simple reranking based on multiple factors
      const reranked = results.map(result => {
        let adjustedScore = result.score;

        // Boost if query terms appear in content
        const queryTerms = query.toLowerCase().split(' ');
        const contentLower = result.content.toLowerCase();
        const termMatches = queryTerms.filter(term => 
          contentLower.includes(term)
        ).length;
        adjustedScore += (termMatches / queryTerms.length) * 0.1;

        // Boost recent documents
        if (result.source?.updatedAt) {
          const daysOld = (Date.now() - result.source.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysOld < 7) adjustedScore += 0.05;
          else if (daysOld < 30) adjustedScore += 0.02;
        }

        // Boost if title matches
        if (result.documentTitle) {
          const titleLower = result.documentTitle.toLowerCase();
          if (titleLower.includes(query.toLowerCase())) {
            adjustedScore += 0.15;
          }
        }

        return {
          ...result,
          score: Math.min(adjustedScore, 1.0) // Cap at 1.0
        };
      });

      // Sort by adjusted score
      return reranked.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error('Reranking failed:', error);
      return results; // Return original results if reranking fails
    }
  }

  /**
   * Add highlights to search results
   * يضيف التمييز للنتائج
   */
  private addHighlights(query: string, results: SearchResult[]): SearchResult[] {
    const queryTerms = query.toLowerCase().split(' ')
      .filter(term => term.length > 2);

    return results.map(result => {
      const highlights: string[] = [];
      const sentences = result.content.split(/[.!?]+/);

      for (const sentence of sentences) {
        const sentenceLower = sentence.toLowerCase();
        const hasMatch = queryTerms.some(term => sentenceLower.includes(term));
        
        if (hasMatch && sentence.trim().length > 0) {
          // Highlight matching terms
          let highlighted = sentence;
          queryTerms.forEach(term => {
            const regex = new RegExp(`(${term})`, 'gi');
            highlighted = highlighted.replace(regex, '**$1**');
          });
          highlights.push(highlighted.trim());
        }
      }

      // Limit to top 3 highlights
      return {
        ...result,
        highlights: highlights.slice(0, 3)
      };
    });
  }

  /**
   * Generate search suggestions
   * يولد اقتراحات البحث
   */
  private async generateSuggestions(
    query: string,
    results: SearchResult[]
  ): Promise<string[]> {
    try {
      // Get related queries from history
      const relatedQueries = await this.getRelatedQueries(query);
      
      // Extract key phrases from top results
      const keyPhrases = this.extractKeyPhrases(results.slice(0, 3));
      
      // Combine and deduplicate
      const suggestions = [...new Set([...relatedQueries, ...keyPhrases])]
        .filter(s => s.toLowerCase() !== query.toLowerCase())
        .slice(0, 5);

      return suggestions;
    } catch (error) {
      logger.error('Failed to generate suggestions:', error);
      return [];
    }
  }

  /**
   * Get related queries from history
   * يحصل على الاستعلامات ذات الصلة
   */
  private async getRelatedQueries(query: string): Promise<string[]> {
    try {
      const key = `search:related:${query.substring(0, 50)}`;
      const cached = await redis.get(key);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Query search history for similar searches
      const similar = await this.prisma.$queryRaw<any[]>`
        SELECT DISTINCT query
        FROM search_logs
        WHERE query != ${query}
          AND similarity(query, ${query}) > 0.3
        ORDER BY created_at DESC
        LIMIT 5
      `;

      const queries = similar.map(s => s.query);
      
      // Cache for 1 hour
      await redis.set(key, JSON.stringify(queries), 'EX', 3600);
      
      return queries;
    } catch (error) {
      logger.error('Failed to get related queries:', error);
      return [];
    }
  }

  /**
   * Extract key phrases from results
   * يستخرج العبارات الرئيسية
   */
  private extractKeyPhrases(results: SearchResult[]): string[] {
    const phrases: string[] = [];
    
    for (const result of results) {
      // Extract noun phrases (simplified)
      const content = result.content.toLowerCase();
      const words = content.split(/\s+/);
      
      for (let i = 0; i < words.length - 1; i++) {
        // Look for 2-3 word phrases
        const phrase2 = `${words[i]} ${words[i + 1]}`;
        if (phrase2.length > 5 && phrase2.length < 50) {
          phrases.push(phrase2);
        }
        
        if (i < words.length - 2) {
          const phrase3 = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
          if (phrase3.length > 8 && phrase3.length < 50) {
            phrases.push(phrase3);
          }
        }
      }
    }

    // Return most common phrases
    const phraseCounts = new Map<string, number>();
    phrases.forEach(p => {
      phraseCounts.set(p, (phraseCounts.get(p) || 0) + 1);
    });

    return Array.from(phraseCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([phrase]) => phrase);
  }

  /**
   * Cache search results
   * يخزن النتائج مؤقتاً
   */
  private async cacheResults(key: string, response: SearchResponse): Promise<void> {
    try {
      await redis.set(
        key,
        JSON.stringify(response),
        'EX',
        this.CACHE_TTL
      );
    } catch (error) {
      logger.warn('Failed to cache search results:', error);
    }
  }

  /**
   * Get cached results
   * يحصل على النتائج المخزنة
   */
  private async getCachedResults(key: string): Promise<SearchResponse | null> {
    try {
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.warn('Failed to get cached results:', error);
      return null;
    }
  }

  /**
   * Generate cache key
   * يولد مفتاح التخزين المؤقت
   */
  private getCacheKey(query: string, options: SearchOptions): string {
    const filters = options.filters ? JSON.stringify(options.filters) : '';
    const key = `search:${query}:${options.limit}:${options.offset}:${filters}`;
    return key.substring(0, 200); // Limit key length
  }

  /**
   * Log search analytics
   * يسجل تحليلات البحث
   */
  private async logSearchAnalytics(query: string, response: SearchResponse): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO search_logs (query, results_count, execution_time, filters, created_at)
        VALUES (${query}, ${response.totalCount}, ${response.executionTime}, ${JSON.stringify(response.filters)}, NOW())
      `;
    } catch (error) {
      logger.warn('Failed to log search analytics:', error);
    }
  }

  /**
   * Search by document ID
   * يبحث بمعرف المستند
   */
  async searchByDocument(
    documentId: string,
    query: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    try {
      // Get document chunks
      const chunks = await this.prisma.chunk.findMany({
        where: { documentId },
        include: {
          document: true
        }
      });

      if (chunks.length === 0) {
        return [];
      }

      // Generate query embedding
      const queryEmbedding = await this.openaiService.generateEmbedding(query);

      // Calculate similarity for each chunk
      const results = chunks.map(chunk => {
        const similarity = this.cosineSimilarity(
          queryEmbedding,
          chunk.embedding as any
        );

        return {
          id: chunk.id,
          content: chunk.content,
          score: similarity,
          documentId: chunk.documentId,
          documentTitle: chunk.document.title,
          pageNumber: chunk.chunkIndex,
          metadata: chunk.metadata as any,
          source: {
            type: chunk.document.type,
            url: chunk.document.url || undefined,
            updatedAt: chunk.document.updatedAt
          }
        };
      });

      // Sort by score and return top results
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      logger.error('Search by document failed:', error);
      throw new AppError('Document search failed', 500);
    }
  }

  /**
   * Find similar documents
   * يجد المستندات المشابهة
   */
  async findSimilarDocuments(
    documentId: string,
    limit: number = 5
  ): Promise<any[]> {
    try {
      // Get the document's average embedding
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        include: {
          chunks: {
            select: { embedding: true }
          }
        }
      });

      if (!document || document.chunks.length === 0) {
        return [];
      }

      // Calculate average embedding
      const avgEmbedding = this.calculateAverageEmbedding(
        document.chunks.map(c => c.embedding as any)
      );

      // Find similar documents
      const vectorString = `[${avgEmbedding.join(',')}]`;
      
      const similar = await this.prisma.$queryRaw<any[]>`
        SELECT DISTINCT
          d.id,
          d.title,
          d.type,
          d.category,
          AVG(1 - (c.embedding <=> ${vectorString}::vector)) as similarity
        FROM documents d
        JOIN chunks c ON c.document_id = d.id
        WHERE d.id != ${documentId}
        GROUP BY d.id, d.title, d.type, d.category
        HAVING AVG(1 - (c.embedding <=> ${vectorString}::vector)) > 0.5
        ORDER BY similarity DESC
        LIMIT ${limit}
      `;

      return similar;
    } catch (error) {
      logger.error('Find similar documents failed:', error);
      throw new AppError('Similar documents search failed', 500);
    }
  }

  /**
   * Multi-modal search (text + filters + metadata)
   * بحث متعدد الوسائط
   */
  async multiModalSearch(
    query: string,
    imageUrl?: string,
    metadata?: any,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    try {
      // Start with text search
      let results = await this.search(query, options);

      // If image URL provided, enhance with image search
      if (imageUrl) {
        // This would integrate with image embedding service
        logger.info('Image search not yet implemented');
      }

      // Filter by metadata if provided
      if (metadata && results.results.length > 0) {
        results.results = results.results.filter(r => {
          if (!r.metadata) return false;
          
          // Check metadata matches
          return Object.entries(metadata).every(([key, value]) => {
            return r.metadata[key] === value;
          });
        });

        results.totalCount = results.results.length;
      }

      return results;
    } catch (error) {
      logger.error('Multi-modal search failed:', error);
      throw new AppError('Multi-modal search failed', 500);
    }
  }

  /**
   * Calculate cosine similarity
   * يحسب التشابه الجيبي
   */
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }

  /**
   * Calculate average embedding
   * يحسب متوسط التضمين
   */
  private calculateAverageEmbedding(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      throw new Error('No embeddings provided');
    }

    const dimensions = embeddings[0].length;
    const average = new Array(dimensions).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        average[i] += embedding[i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      average[i] /= embeddings.length;
    }

    return average;
  }

  /**
   * Clear search cache
   * يمسح ذاكرة التخزين المؤقت
   */
  async clearCache(pattern?: string): Promise<void> {
    try {
      const keys = await redis.keys(pattern || 'search:*');
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info(`Cleared ${keys.length} cached search results`);
      }
    } catch (error) {
      logger.error('Failed to clear search cache:', error);
    }
  }

  /**
   * Get search statistics
   * يحصل على إحصائيات البحث
   */
  async getSearchStats(days: number = 7): Promise<any> {
    try {
      const stats = await this.prisma.$queryRaw<any[]>`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as search_count,
          AVG(results_count) as avg_results,
          AVG(execution_time) as avg_time,
          COUNT(DISTINCT query) as unique_queries
        FROM search_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `;

      const topQueries = await this.prisma.$queryRaw<any[]>`
        SELECT 
          query,
          COUNT(*) as count,
          AVG(results_count) as avg_results
        FROM search_logs
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY query
        ORDER BY count DESC
        LIMIT 10
      `;

      return {
        daily: stats,
        topQueries,
        totalSearches: stats.reduce((sum, day) => sum + parseInt(day.search_count), 0),
        avgResponseTime: stats.reduce((sum, day) => sum + parseFloat(day.avg_time), 0) / stats.length
      };
    } catch (error) {
      logger.error('Failed to get search stats:', error);
      throw new AppError('Failed to get search statistics', 500);
    }
  }
}