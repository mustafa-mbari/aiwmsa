// backend/src/services/ai/embedding.service.ts

import { PrismaClient } from '@prisma/client';
import { OpenAIService } from './openai.service';
import { logger } from '../../utils/logger';
import { Queue, Job } from 'bull';
import { redis } from '../../config/redis';
import crypto from 'crypto';

interface EmbeddingTask {
  id: string;
  type: 'chunk' | 'document' | 'query';
  text: string;
  metadata?: any;
  priority?: number;
}

interface EmbeddingResult {
  id: string;
  embedding: number[];
  model: string;
  tokensUsed: number;
  processingTime: number;
}

interface BatchEmbeddingOptions {
  batchSize?: number;
  delayMs?: number;
  maxRetries?: number;
  priority?: number;
}

export class EmbeddingService {
  private prisma: PrismaClient;
  private openaiService: OpenAIService;
  private embeddingQueue: Queue<EmbeddingTask>;
  private readonly MODEL = process.env.OPENAI_MODEL_EMBEDDING || 'text-embedding-3-small';
  private readonly DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536');
  private readonly BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE || '100');
  private costTracker: Map<string, number> = new Map();

  constructor() {
    this.prisma = new PrismaClient();
    this.openaiService = new OpenAIService();
    
    // Initialize embedding queue
    this.embeddingQueue = new Queue('embeddings', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD
      }
    });

    this.setupQueueProcessors();
  }

  /**
   * Setup queue processors
   * يهيئ معالجات الطوابير
   */
  private setupQueueProcessors(): void {
    // Process embedding tasks
    this.embeddingQueue.process('generate', 5, async (job: Job<EmbeddingTask>) => {
      return await this.processEmbeddingTask(job.data);
    });

    // Process batch embeddings
    this.embeddingQueue.process('batch', 2, async (job: Job<EmbeddingTask[]>) => {
      return await this.processBatchEmbeddings(job.data);
    });

    // Log queue events
    this.embeddingQueue.on('completed', (job) => {
      logger.info(`Embedding job ${job.id} completed`);
    });

    this.embeddingQueue.on('failed', (job, err) => {
      logger.error(`Embedding job ${job?.id} failed:`, err);
    });
  }

  /**
   * Generate embedding for text
   * يولد تضمين للنص
   */
  async generateEmbedding(
    text: string,
    metadata?: any,
    useCache: boolean = true
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    try {
      // Check cache if enabled
      if (useCache) {
        const cached = await this.getCachedEmbedding(text);
        if (cached) {
          logger.debug('Using cached embedding');
          return {
            id: this.generateHash(text),
            embedding: cached,
            model: this.MODEL,
            tokensUsed: 0,
            processingTime: Date.now() - startTime
          };
        }
      }

      // Preprocess text
      const processedText = this.preprocessText(text, metadata);

      // Generate embedding
      const embedding = await this.openaiService.generateEmbedding(processedText, {
        model: this.MODEL,
        dimensions: this.DIMENSIONS
      });

      // Calculate tokens (approximate)
      const tokensUsed = await this.estimateTokens(processedText);

      // Cache the embedding
      if (useCache) {
        await this.cacheEmbedding(text, embedding);
      }

      // Track cost
      await this.trackCost(tokensUsed);

      return {
        id: this.generateHash(text),
        embedding,
        model: this.MODEL,
        tokensUsed,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      logger.error('Failed to generate embedding:', error);
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts
   * يولد تضمينات لنصوص متعددة
   */
  async generateBatchEmbeddings(
    texts: string[],
    options: BatchEmbeddingOptions = {}
  ): Promise<EmbeddingResult[]> {
    const {
      batchSize = this.BATCH_SIZE,
      delayMs = 1000,
      maxRetries = 3
    } = options;

    const results: EmbeddingResult[] = [];
    
    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      try {
        const embeddings = await this.openaiService.generateBatchEmbeddings(batch, {
          model: this.MODEL,
          dimensions: this.DIMENSIONS
        });

        // Create results
        batch.forEach((text, index) => {
          results.push({
            id: this.generateHash(text),
            embedding: embeddings[index],
            model: this.MODEL,
            tokensUsed: Math.ceil(text.length / 4), // Rough estimate
            processingTime: 0
          });
        });

        // Add delay between batches to avoid rate limits
        if (i + batchSize < texts.length) {
          await this.delay(delayMs);
        }
      } catch (error) {
        logger.error(`Batch ${i / batchSize} failed:`, error);
        
        // Retry individual items on batch failure
        for (const text of batch) {
          try {
            const result = await this.generateEmbedding(text);
            results.push(result);
          } catch (err) {
            logger.error(`Failed to generate embedding for text:`, err);
          }
        }
      }
    }

    return results;
  }

  /**
   * Queue embedding generation task
   * يضيف مهمة توليد التضمين للطابور
   */
  async queueEmbeddingTask(
    task: EmbeddingTask,
    priority: number = 0
  ): Promise<string> {
    const job = await this.embeddingQueue.add('generate', task, {
      priority,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });
    
    logger.info(`Queued embedding task: ${job.id}`);
    return job.id as string;
  }

  /**
   * Queue batch embedding tasks
   * يضيف مهام التضمين الجماعية للطابور
   */
  async queueBatchEmbeddings(
    tasks: EmbeddingTask[],
    priority: number = 0
  ): Promise<string> {
    const job = await this.embeddingQueue.add('batch', tasks, {
      priority,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    });
    
    logger.info(`Queued batch embedding task with ${tasks.length} items: ${job.id}`);
    return job.id as string;
  }

  /**
   * Process single embedding task
   * يعالج مهمة تضمين واحدة
   */
  private async processEmbeddingTask(task: EmbeddingTask): Promise<EmbeddingResult> {
    try {
      const result = await this.generateEmbedding(task.text, task.metadata);
      
      // Save to database based on type
      if (task.type === 'chunk' && task.id) {
        await this.updateChunkEmbedding(task.id, result.embedding);
      }
      
      return result;
    } catch (error) {
      logger.error(`Failed to process embedding task ${task.id}:`, error);
      throw error;
    }
  }

  /**
   * Process batch embeddings
   * يعالج التضمينات الجماعية
   */
  private async processBatchEmbeddings(tasks: EmbeddingTask[]): Promise<EmbeddingResult[]> {
    const texts = tasks.map(t => t.text);
    const results = await this.generateBatchEmbeddings(texts);
    
    // Update database for each result
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const result = results[i];
      
      if (task.type === 'chunk' && task.id && result) {
        await this.updateChunkEmbedding(task.id, result.embedding);
      }
    }
    
    return results;
  }

  /**
   * Generate embeddings for document chunks
   * يولد تضمينات لأجزاء المستند
   */
  async generateDocumentEmbeddings(documentId: string): Promise<void> {
    try {
      // Get all chunks for document
      const chunks = await this.prisma.chunk.findMany({
        where: { 
          documentId,
          embedding: null 
        },
        orderBy: { chunkIndex: 'asc' }
      });

      if (chunks.length === 0) {
        logger.info(`No chunks to process for document ${documentId}`);
        return;
      }

      logger.info(`Generating embeddings for ${chunks.length} chunks of document ${documentId}`);

      // Process in batches
      const tasks: EmbeddingTask[] = chunks.map(chunk => ({
        id: chunk.id,
        type: 'chunk',
        text: chunk.content,
        metadata: chunk.metadata
      }));

      // Queue for processing
      await this.queueBatchEmbeddings(tasks, 1);
    } catch (error) {
      logger.error(`Failed to generate document embeddings:`, error);
      throw error;
    }
  }

  /**
   * Update chunk embedding in database
   * يحدث تضمين الجزء في قاعدة البيانات
   */
  private async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE chunks 
        SET embedding = ${embedding}::vector,
            updated_at = NOW()
        WHERE id = ${chunkId}
      `;
      
      logger.debug(`Updated embedding for chunk ${chunkId}`);
    } catch (error) {
      logger.error(`Failed to update chunk embedding:`, error);
      throw error;
    }
  }

  /**
   * Preprocess text before embedding
   * يعالج النص قبل التضمين
   */
  private preprocessText(text: string, metadata?: any): string {
    let processed = text;

    // Clean and normalize text
    processed = processed
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();

    // Add metadata context if available
    if (metadata) {
      const contextParts = [];
      
      if (metadata.title) {
        contextParts.push(`Title: ${metadata.title}`);
      }
      if (metadata.category) {
        contextParts.push(`Category: ${metadata.category}`);
      }
      if (metadata.department) {
        contextParts.push(`Department: ${metadata.department}`);
      }
      if (metadata.tags && metadata.tags.length > 0) {
        contextParts.push(`Tags: ${metadata.tags.join(', ')}`);
      }

      if (contextParts.length > 0) {
        processed = `${contextParts.join(' | ')} | Content: ${processed}`;
      }
    }

    // Truncate if too long (max ~8000 tokens ≈ 32000 chars)
    if (processed.length > 32000) {
      processed = processed.substring(0, 32000);
    }

    return processed;
  }

  /**
   * Get cached embedding
   * يحصل على التضمين المخزن
   */
  private async getCachedEmbedding(text: string): Promise<number[] | null> {
    try {
      const hash = this.generateHash(text);
      
      // Check Redis cache first
      const cached = await redis.get(`embedding:${hash}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // Check database cache
      const dbCached = await this.prisma.$queryRaw<any[]>`
        SELECT embedding 
        FROM cached_embeddings 
        WHERE text_hash = ${hash}
      `;

      if (dbCached.length > 0) {
        const embedding = dbCached[0].embedding;
        
        // Update usage stats
        await this.prisma.$executeRaw`
          UPDATE cached_embeddings 
          SET usage_count = usage_count + 1,
              last_used_at = NOW()
          WHERE text_hash = ${hash}
        `;

        // Cache in Redis
        await redis.set(`embedding:${hash}`, JSON.stringify(embedding), 'EX', 3600);
        
        return embedding;
      }

      return null;
    } catch (error) {
      logger.warn('Failed to get cached embedding:', error);
      return null;
    }
  }

  /**
   * Cache embedding
   * يخزن التضمين
   */
  private async cacheEmbedding(text: string, embedding: number[]): Promise<void> {
    try {
      const hash = this.generateHash(text);
      
      // Cache in Redis (1 hour)
      await redis.set(`embedding:${hash}`, JSON.stringify(embedding), 'EX', 3600);
      
      // Cache in database for long-term storage
      await this.prisma.$executeRaw`
        INSERT INTO cached_embeddings (text_hash, text, embedding, model, created_at)
        VALUES (${hash}, ${text}, ${embedding}::vector, ${this.MODEL}, NOW())
        ON CONFLICT (text_hash) 
        DO UPDATE SET 
          usage_count = cached_embeddings.usage_count + 1,
          last_used_at = NOW()
      `;
    } catch (error) {
      logger.warn('Failed to cache embedding:', error);
    }
  }

  /**
   * Estimate token count
   * يقدر عدد التوكنز
   */
  private async estimateTokens(text: string): Promise<number> {
    // Simple estimation: ~4 chars per token for English, ~2 for Arabic
    const hasArabic = /[\u0600-\u06FF]/.test(text);
    const avgCharsPerToken = hasArabic ? 2 : 4;
    return Math.ceil(text.length / avgCharsPerToken);
  }

  /**
   * Track embedding costs
   * يتتبع تكاليف التضمين
   */
  private async trackCost(tokens: number): Promise<void> {
    const costPer1kTokens = 0.00002; // text-embedding-3-small pricing
    const cost = (tokens / 1000) * costPer1kTokens;
    
    const today = new Date().toISOString().split('T')[0];
    const current = this.costTracker.get(today) || 0;
    this.costTracker.set(today, current + cost);
    
    // Store in Redis for persistence
    const key = `embedding:cost:${today}`;
    await redis.incrby(key, Math.round(cost * 10000));
    await redis.expire(key, 2592000); // 30 days
    
    logger.debug(`Embedding cost: ${tokens} tokens = ${cost.toFixed(6)}`);
  }

  /**
   * Get embedding statistics
   * يحصل على إحصائيات التضمين
   */
  async getStatistics(): Promise<any> {
    try {
      // Get queue stats
      const queueStats = await this.embeddingQueue.getJobCounts();
      
      // Get cost stats
      const costStats: any = {};
      for (const [date, cost] of this.costTracker.entries()) {
        costStats[date] = cost;
      }
      
      // Get cache stats
      const cacheStats = await this.prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_cached,
          SUM(usage_count) as total_uses,
          AVG(usage_count) as avg_uses
        FROM cached_embeddings
      `;
      
      // Get processing stats
      const processingStats = await this.prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_chunks,
          COUNT(embedding) as chunks_with_embeddings,
          COUNT(*) - COUNT(embedding) as chunks_without_embeddings
        FROM chunks
      `;
      
      return {
        queue: queueStats,
        costs: costStats,
        cache: cacheStats[0],
        processing: processingStats[0]
      };
    } catch (error) {
      logger.error('Failed to get embedding statistics:', error);
      return {};
    }
  }

  /**
   * Clean up old cached embeddings
   * ينظف التضمينات المخزنة القديمة
   */
  async cleanupCache(daysOld: number = 30, minUsageCount: number = 5): Promise<number> {
    try {
      const result = await this.prisma.$executeRaw`
        DELETE FROM cached_embeddings
        WHERE last_used_at < NOW() - INTERVAL '${daysOld} days'
          AND usage_count < ${minUsageCount}
      `;
      
      logger.info(`Cleaned up ${result} old cached embeddings`);
      return result;
    } catch (error) {
      logger.error('Failed to cleanup cache:', error);
      return 0;
    }
  }

  /**
   * Generate hash for text
   * يولد hash للنص
   */
  private generateHash(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * Delay utility
   * أداة التأخير
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate embeddings
   * يتحقق من صحة التضمينات
   */
  async validateEmbeddings(documentId?: string): Promise<{
    valid: number;
    invalid: number;
    missing: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let valid = 0;
    let invalid = 0;
    let missing = 0;

    try {
      const whereClause = documentId ? { documentId } : {};
      const chunks = await this.prisma.chunk.findMany({
        where: whereClause,
        select: {
          id: true,
          embedding: true
        }
      });

      for (const chunk of chunks) {
        if (!chunk.embedding) {
          missing++;
        } else if (Array.isArray(chunk.embedding)) {
          if (chunk.embedding.length === this.DIMENSIONS) {
            valid++;
          } else {
            invalid++;
            errors.push(`Chunk ${chunk.id}: Wrong dimension ${chunk.embedding.length}`);
          }
        } else {
          invalid++;
          errors.push(`Chunk ${chunk.id}: Invalid embedding type`);
        }
      }

      return { valid, invalid, missing, errors };
    } catch (error) {
      logger.error('Failed to validate embeddings:', error);
      throw error;
    }
  }

  /**
   * Regenerate missing embeddings
   * يعيد توليد التضمينات المفقودة
   */
  async regenerateMissingEmbeddings(batchSize: number = 10): Promise<number> {
    try {
      const chunks = await this.prisma.chunk.findMany({
        where: { embedding: null },
        take: batchSize
      });

      if (chunks.length === 0) {
        return 0;
      }

      const tasks: EmbeddingTask[] = chunks.map(chunk => ({
        id: chunk.id,
        type: 'chunk',
        text: chunk.content,
        metadata: chunk.metadata
      }));

      await this.queueBatchEmbeddings(tasks, 2);
      
      return chunks.length;
    } catch (error) {
      logger.error('Failed to regenerate embeddings:', error);
      throw error;
    }
  }
}