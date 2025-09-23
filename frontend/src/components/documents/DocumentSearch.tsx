// wmlab/backend/src/routes/search.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { EmbeddingService } from '../services/embeddings/embeddingService';
import { AIService } from '../services/ai/aiService';
import { prisma } from '../lib/prisma';

const router = Router();
const embeddingService = new EmbeddingService();
const aiService = new AIService();

// Semantic search schema
const semanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().min(1).max(50).default(10),
  filters: z.object({
    warehouseId: z.string().optional(),
    category: z.string().optional(),
    language: z.string().optional(),
    departmentId: z.string().optional(),
  }).optional(),
});

// AI search schema
const aiSearchSchema = z.object({
  query: z.string().min(1).max(500),
  filters: z.object({
    warehouseId: z.string().optional(),
    category: z.string().optional(),
    language: z.string().optional(),
  }).optional(),
  conversationId: z.string().optional(),
});

// Semantic search endpoint
router.post(
  '/semantic',
  authenticate,
  validate(semanticSearchSchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      const { query, limit, filters } = req.body;
      const userId = (req as any).user.userId;

      // Log the query
      const queryLog = await prisma.query.create({
        data: {
          userId,
          query,
          context: { type: 'semantic', filters },
        },
      });

      // Perform semantic search
      const results = await embeddingService.searchSimilar(query, limit, filters);

      // Format results
      const formattedResults = results.map(result => ({
        id: result.id,
        documentId: result.documentId,
        documentTitle: result.documentTitle,
        category: result.category,
        content: result.content,
        similarity: result.similarity,
        metadata: result.metadata,
        originalName: result.originalName,
      }));

      // Update query log
      await prisma.query.update({
        where: { id: queryLog.id },
        data: {
          response: JSON.stringify(formattedResults),
          duration: Date.now() - startTime,
          successful: true,
        },
      });

      res.json({
        results: formattedResults,
        query,
        processingTime: Date.now() - startTime,
      });
    } catch (error) {
      console.error('Semantic search error:', error);
      res.status(500).json({ error: 'Search failed' });
    }
  }
);

// AI-powered search endpoint
router.post(
  '/ai',
  authenticate,
  validate(aiSearchSchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      const { query, filters, conversationId } = req.body;
      const userId = (req as any).user.userId;

      // Log the query
      const queryLog = await prisma.query.create({
        data: {
          userId,
          query,
          context: { type: 'ai', filters, conversationId },
        },
      });

      // First, get relevant chunks
      const relevantChunks = await embeddingService.searchSimilar(query, 10, filters);

      // Generate AI response
      const aiResponse = await aiService.generateAnswer(query, relevantChunks, conversationId);

      // Update query log
      await prisma.query.update({
        where: { id: queryLog.id },
        data: {
          response: aiResponse.answer,
          duration: Date.now() - startTime,
          successful: true,
          context: {
            type: 'ai',
            filters,
            conversationId,
            sources: relevantChunks.map(c => c.id),
            confidence: aiResponse.confidence,
          },
        },
      });

      res.json({
        answer: aiResponse.answer,
        sources: relevantChunks,
        confidence: aiResponse.confidence,
        processingTime: Date.now() - startTime,
        queryId: queryLog.id,
      });
    } catch (error) {
      console.error('AI search error:', error);
      res.status(500).json({ error: 'AI search failed' });
    }
  }
);

// Search feedback endpoint
router.post(
  '/feedback',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { queryId, resultId, helpful, rating, comment } = req.body;
      const userId = (req as any).user.userId;

      if (!queryId && !resultId) {
        return res.status(400).json({ error: 'Query ID or Result ID required' });
      }

      // Create feedback
      const feedback = await prisma.feedback.create({
        data: {
          queryId: queryId || resultId,
          userId,
          helpful,
          rating: rating || (helpful ? 5 : 1),
          comment,
        },
      });

      res.json({ success: true, feedbackId: feedback.id });
    } catch (error) {
      console.error('Feedback error:', error);
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  }
);

// Get search history
router.get(
  '/history',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.userId;
      const { limit = '10', offset = '0' } = req.query;

      const queries = await prisma.query.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
        include: {
          feedback: true,
        },
      });

      res.json(queries);
    } catch (error) {
      console.error('History error:', error);
      res.status(500).json({ error: 'Failed to fetch search history' });
    }
  }
);

// Get trending searches
router.get(
  '/trending',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { days = '7' } = req.query;
      const since = new Date();
      since.setDate(since.getDate() - parseInt(days as string));

      // Get most common queries
      const queries = await prisma.$queryRaw`
        SELECT 
          query,
          COUNT(*) as count,
          AVG(CASE WHEN f.rating IS NOT NULL THEN f.rating ELSE 0 END) as avg_rating
        FROM queries q
        LEFT JOIN feedback f ON f."queryId" = q.id
        WHERE q."createdAt" > ${since}
        GROUP BY query
        ORDER BY count DESC
        LIMIT 10
      `;

      res.json(queries);
    } catch (error) {
      console.error('Trending error:', error);
      res.status(500).json({ error: 'Failed to fetch trending searches' });
    }
  }
);

export default router;

// wmlab/backend/src/services/ai/aiService.ts
import { OpenAI } from 'openai';
import { prisma } from '../../lib/prisma';

export class AIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateAnswer(
    query: string,
    relevantChunks: any[],
    conversationId?: string
  ): Promise<{ answer: string; confidence: number }> {
    try {
      // Build context from relevant chunks
      const context = relevantChunks
        .map((chunk, index) => `
[Source ${index + 1}] ${chunk.documentTitle}:
${chunk.content}
        `)
        .join('\n\n');

      // Get conversation history if provided
      let conversationHistory = '';
      if (conversationId) {
        const previousQueries = await prisma.query.findMany({
          where: {
            context: {
              path: ['conversationId'],
              equals: conversationId,
            },
          },
          orderBy: { createdAt: 'asc' },
          take: 5,
        });

        conversationHistory = previousQueries
          .map(q => `User: ${q.query}\nAssistant: ${q.response}`)
          .join('\n\n');
      }

      // Build the prompt
      const systemPrompt = `You are an AI assistant for a warehouse management system. 
Your role is to help warehouse workers find information from their documentation.
Answer questions based on the provided context. If the context doesn't contain 
enough information to answer fully, say so clearly.

Guidelines:
- Be concise and direct
- Reference source documents when possible
- Provide step-by-step instructions when relevant
- Highlight safety considerations
- Use clear, simple language suitable for warehouse workers
- If multiple languages are detected, respond in the user's language`;

      const userPrompt = `${conversationHistory ? `Previous conversation:\n${conversationHistory}\n\n` : ''}
Context from documentation:
${context}

Question: ${query}

Please provide a helpful answer based on the context above. If the context doesn't 
fully answer the question, acknowledge what information is missing.`;

      // Generate response
      const completion = await this.openai.chat.completions.create({
        model: process.env.AI_MODEL || 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const answer = completion.choices[0].message.content || 'Unable to generate answer';

      // Calculate confidence based on relevance scores
      const avgSimilarity = relevantChunks.reduce((acc, chunk) => acc + chunk.similarity, 0) / relevantChunks.length;
      const confidence = Math.min(avgSimilarity * 1.2, 1); // Scale up slightly but cap at 1

      return {
        answer,
        confidence,
      };
    } catch (error) {
      console.error('AI generation error:', error);
      throw new Error('Failed to generate AI response');
    }
  }

  async summarizeDocument(documentId: string): Promise<string> {
    try {
      // Get all chunks for the document
      const chunks = await prisma.chunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
      });

      if (chunks.length === 0) {
        throw new Error('No chunks found for document');
      }

      // Combine chunks (limit to avoid token limits)
      const text = chunks
        .slice(0, 10)
        .map(c => c.content)
        .join('\n\n');

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Summarize the following document content in 2-3 paragraphs, highlighting key points and important information.',
          },
          {
            role: 'user',
            content: text,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      return completion.choices[0].message.content || 'Unable to generate summary';
    } catch (error) {
      console.error('Summarization error:', error);
      throw new Error('Failed to summarize document');
    }
  }
}