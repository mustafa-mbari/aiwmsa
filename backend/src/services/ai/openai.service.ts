// backend/src/services/ai/openai.service.ts

import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { logger } from '../../utils/logger';
import { AppError } from '../../middleware/error';
import { redis } from '../../config/redis';
import pRetry from 'p-retry';

interface EmbeddingOptions {
  model?: string;
  dimensions?: number;
  user?: string;
}

interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  user?: string;
  systemPrompt?: string;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export class OpenAIService {
  private client: OpenAI;
  private embeddingModel: string;
  private chatModel: string;
  private maxRetries: number = 3;
  private costTracker: Map<string, number> = new Map();

  constructor() {
    this.validateConfiguration();
    
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      organization: process.env.OPENAI_ORG_ID,
      maxRetries: this.maxRetries,
      timeout: 30000, // 30 seconds
    });

    this.embeddingModel = process.env.OPENAI_MODEL_EMBEDDING || 'text-embedding-3-small';
    this.chatModel = process.env.OPENAI_MODEL_CHAT || 'gpt-4-turbo-preview';
  }

  private validateConfiguration(): void {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
  }

  /**
   * Generate embeddings for text
   * يولد vectors للنص المدخل
   */
  async generateEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<number[]> {
    try {
      // Check cache first
      const cacheKey = `embedding:${this.hashText(text)}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('Embedding retrieved from cache');
        return JSON.parse(cached);
      }

      // Generate new embedding
      const response = await pRetry(
        async () => {
          return await this.client.embeddings.create({
            model: options.model || this.embeddingModel,
            input: text,
            dimensions: options.dimensions,
            user: options.user,
          });
        },
        {
          retries: this.maxRetries,
          onFailedAttempt: (error) => {
            logger.warn(`Embedding generation attempt ${error.attemptNumber} failed:`, error);
          },
        }
      );

      const embedding = response.data[0].embedding;
      
      // Track usage
      await this.trackUsage('embedding', response.usage?.total_tokens || 0);

      // Cache the result (expire in 7 days)
      await redis.set(cacheKey, JSON.stringify(embedding), 'EX', 604800);

      return embedding;
    } catch (error) {
      logger.error('Failed to generate embedding:', error);
      throw new AppError('Failed to generate text embedding', 500);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * يولد vectors لمجموعة نصوص
   */
  async generateBatchEmbeddings(
    texts: string[],
    options: EmbeddingOptions = {}
  ): Promise<number[][]> {
    try {
      // OpenAI allows up to 2048 embeddings per request
      const batchSize = 100;
      const embeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        
        const response = await pRetry(
          async () => {
            return await this.client.embeddings.create({
              model: options.model || this.embeddingModel,
              input: batch,
              dimensions: options.dimensions,
              user: options.user,
            });
          },
          {
            retries: this.maxRetries,
            onFailedAttempt: (error) => {
              logger.warn(`Batch embedding attempt ${error.attemptNumber} failed:`, error);
            },
          }
        );

        const batchEmbeddings = response.data.map(d => d.embedding);
        embeddings.push(...batchEmbeddings);

        // Track usage
        await this.trackUsage('embedding', response.usage?.total_tokens || 0);

        // Add delay to avoid rate limits
        if (i + batchSize < texts.length) {
          await this.delay(1000); // 1 second delay between batches
        }
      }

      return embeddings;
    } catch (error) {
      logger.error('Failed to generate batch embeddings:', error);
      throw new AppError('Failed to generate batch embeddings', 500);
    }
  }

  /**
   * Generate completion using GPT model
   * يولد إجابة باستخدام GPT
   */
  async generateCompletion(
    messages: ChatCompletionMessageParam[],
    options: CompletionOptions = {}
  ): Promise<{ content: string; usage: TokenUsage }> {
    try {
      const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: options.systemPrompt || this.getDefaultSystemPrompt(),
      };

      const allMessages = [systemMessage, ...messages];

      const response = await pRetry(
        async () => {
          return await this.client.chat.completions.create({
            model: options.model || this.chatModel,
            messages: allMessages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2000,
            top_p: options.topP ?? 1,
            frequency_penalty: options.frequencyPenalty ?? 0,
            presence_penalty: options.presencePenalty ?? 0,
            user: options.user,
          });
        },
        {
          retries: this.maxRetries,
          onFailedAttempt: (error) => {
            logger.warn(`Completion attempt ${error.attemptNumber} failed:`, error);
          },
        }
      );

      const content = response.choices[0]?.message?.content || '';
      const usage = this.calculateUsage(response.usage);

      // Track usage
      await this.trackUsage('completion', usage.totalTokens);

      return { content, usage };
    } catch (error) {
      logger.error('Failed to generate completion:', error);
      throw new AppError('Failed to generate AI response', 500);
    }
  }

  /**
   * Stream completion using GPT model
   * يولد إجابة متدفقة
   */
  async *streamCompletion(
    messages: ChatCompletionMessageParam[],
    options: CompletionOptions = {}
  ): AsyncGenerator<string> {
    try {
      const systemMessage: ChatCompletionMessageParam = {
        role: 'system',
        content: options.systemPrompt || this.getDefaultSystemPrompt(),
      };

      const stream = await this.client.chat.completions.create({
        model: options.model || this.chatModel,
        messages: [systemMessage, ...messages],
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        stream: true,
        user: options.user,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }
    } catch (error) {
      logger.error('Failed to stream completion:', error);
      throw new AppError('Failed to stream AI response', 500);
    }
  }

  /**
   * Check content moderation
   * يتحقق من سلامة المحتوى
   */
  async moderateContent(text: string): Promise<boolean> {
    try {
      const response = await this.client.moderations.create({
        input: text,
      });

      const result = response.results[0];
      return !result.flagged;
    } catch (error) {
      logger.error('Failed to moderate content:', error);
      // Default to safe in case of error
      return true;
    }
  }

  /**
   * Calculate token count for text
   * يحسب عدد التوكنز
   */
  async countTokens(text: string): Promise<number> {
    // Rough estimation: 1 token ≈ 4 characters for English
    // For Arabic: 1 token ≈ 2 characters
    const hasArabic = /[\u0600-\u06FF]/.test(text);
    const avgCharsPerToken = hasArabic ? 2 : 4;
    return Math.ceil(text.length / avgCharsPerToken);
  }

  /**
   * Track API usage and costs
   * يتتبع الاستخدام والتكاليف
   */
  private async trackUsage(type: 'embedding' | 'completion', tokens: number): Promise<void> {
    const costs = {
      embedding: 0.00002, // per 1K tokens for text-embedding-3-small
      completion: {
        input: 0.01,      // per 1K tokens for GPT-4 Turbo input
        output: 0.03,     // per 1K tokens for GPT-4 Turbo output
      },
    };

    let cost = 0;
    if (type === 'embedding') {
      cost = (tokens / 1000) * costs.embedding;
    } else {
      // Rough estimate: 70% input, 30% output
      cost = (tokens * 0.7 / 1000) * costs.completion.input +
             (tokens * 0.3 / 1000) * costs.completion.output;
    }

    // Update daily cost tracker
    const today = new Date().toISOString().split('T')[0];
    const currentCost = this.costTracker.get(today) || 0;
    this.costTracker.set(today, currentCost + cost);

    // Store in Redis for persistence
    const redisKey = `openai:cost:${today}`;
    await redis.incrby(redisKey, Math.round(cost * 10000)); // Store as cents * 100
    await redis.expire(redisKey, 2592000); // Expire in 30 days

    logger.info(`OpenAI usage: ${type} - ${tokens} tokens - $${cost.toFixed(4)}`);
  }

  /**
   * Get usage statistics
   * يحصل على إحصائيات الاستخدام
   */
  async getUsageStats(days: number = 30): Promise<any> {
    const stats: any = {};
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      const redisKey = `openai:cost:${dateKey}`;
      const cost = await redis.get(redisKey);
      
      if (cost) {
        stats[dateKey] = parseInt(cost) / 10000; // Convert back to dollars
      }
    }

    return {
      daily: stats,
      total: Object.values(stats).reduce((a: any, b: any) => a + b, 0),
      average: Object.values(stats).reduce((a: any, b: any) => a + b, 0) / days,
    };
  }

  /**
   * Calculate usage from OpenAI response
   */
  private calculateUsage(usage: any): TokenUsage {
    const promptTokens = usage?.prompt_tokens || 0;
    const completionTokens = usage?.completion_tokens || 0;
    const totalTokens = usage?.total_tokens || 0;

    // Calculate estimated cost
    const inputCost = (promptTokens / 1000) * 0.01;  // $0.01 per 1K tokens
    const outputCost = (completionTokens / 1000) * 0.03; // $0.03 per 1K tokens
    const estimatedCost = inputCost + outputCost;

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost,
    };
  }

  /**
   * Get default system prompt
   */
  private getDefaultSystemPrompt(): string {
    return `You are an AI assistant for a warehouse management system. 
    You help workers find information quickly and accurately. 
    You can respond in Arabic, English, or German based on the user's language.
    Always provide clear, concise, and helpful answers.
    If you're not sure about something, say so.`;
  }

  /**
   * Hash text for caching
   */
  private hashText(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(text).digest('hex');
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if API key is valid
   */
  async validateAPIKey(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      logger.error('Invalid OpenAI API key:', error);
      return false;
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((model: any) => model.id);
    } catch (error) {
      logger.error('Failed to fetch models:', error);
      return [];
    }
  }
}