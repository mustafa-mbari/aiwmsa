// wmlab/backend/src/services/queue/documentQueue.ts
import Bull from 'bull';
import { DocumentProcessor } from '../documentProcessors';
import { EmbeddingService } from '../embeddings/embeddingService';
import { prisma } from '../../lib/prisma';
import Redis from 'ioredis';

// Create Redis connection
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
};

// Create Bull queue
export const documentQueue = new Bull('document-processing', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Document processor instance
const documentProcessor = new DocumentProcessor();
const embeddingService = new EmbeddingService();

// Process documents
documentQueue.process('process-document', async (job) => {
  const { documentId } = job.data;
  console.log(`Processing document: ${documentId}`);

  try {
    // Update job progress
    await job.progress(10);

    // Process document
    await documentProcessor.process(documentId);
    
    await job.progress(50);

    // Generate embeddings
    await embeddingService.generateDocumentEmbeddings(documentId);
    
    await job.progress(100);

    console.log(`Document ${documentId} processed successfully`);
    return { success: true, documentId };
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    throw error;
  }
});

// Process embeddings separately for better performance
documentQueue.process('generate-embeddings', async (job) => {
  const { chunkIds } = job.data;
  console.log(`Generating embeddings for ${chunkIds.length} chunks`);

  try {
    await embeddingService.generateChunkEmbeddings(chunkIds);
    return { success: true, count: chunkIds.length };
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw error;
  }
});

// Event handlers
documentQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

documentQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
});

documentQueue.on('stalled', (job) => {
  console.warn(`Job ${job.id} stalled`);
});

// Export function to add job to queue
export async function queueDocumentForProcessing(documentId: string) {
  const job = await documentQueue.add('process-document', { documentId });
  return job.id;
}

// wmlab/backend/src/services/embeddings/embeddingService.ts
import { OpenAI } from 'openai';
import { prisma } from '../../lib/prisma';
import { chunk as chunkArray } from 'lodash';

export class EmbeddingService {
  private openai: OpenAI;
  private model: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  }

  async generateDocumentEmbeddings(documentId: string): Promise<void> {
    try {
      // Get all chunks for the document
      const chunks = await prisma.chunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
      });

      if (chunks.length === 0) {
        throw new Error('No chunks found for document');
      }

      // Process chunks in batches to avoid rate limits
      const batchSize = 20;
      const batches = chunkArray(chunks, batchSize);

      for (const batch of batches) {
        await this.processBatch(batch);
        
        // Update progress
        const progress = Math.round(
          (batches.indexOf(batch) + 1) / batches.length * 100
        );
        await prisma.document.update({
          where: { id: documentId },
          data: { processingProgress: 80 + (progress * 0.2) }, // 80-100%
        });

        // Rate limiting
        await this.delay(1000);
      }

    } catch (error) {
      console.error('Error generating document embeddings:', error);
      throw error;
    }
  }

  async generateChunkEmbeddings(chunkIds: string[]): Promise<void> {
    const chunks = await prisma.chunk.findMany({
      where: { id: { in: chunkIds } },
    });

    const batches = chunkArray(chunks, 20);
    for (const batch of batches) {
      await this.processBatch(batch);
      await this.delay(1000);
    }
  }

  private async processBatch(chunks: any[]): Promise<void> {
    try {
      const texts = chunks.map(chunk => chunk.content);
      
      // Generate embeddings
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: texts,
        encoding_format: 'float',
      });

      // Save embeddings to database
      const embeddings = response.data.map((item, index) => ({
        chunkId: chunks[index].id,
        embedding: item.embedding,
        model: this.model,
        dimensions: item.embedding.length,
      }));

      // Use transaction to ensure consistency
      await prisma.$transaction([
        // Delete existing embeddings
        prisma.embedding.deleteMany({
          where: {
            chunkId: { in: chunks.map(c => c.id) },
          },
        }),
        // Create new embeddings
        prisma.embedding.createMany({
          data: embeddings,
        }),
      ]);

    } catch (error) {
      console.error('Error processing batch:', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Search for similar chunks using vector similarity
  async searchSimilar(query: string, limit: number = 10, filters?: any): Promise<any[]> {
    try {
      // Generate embedding for query
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: query,
      });

      const queryEmbedding = response.data[0].embedding;

      // Build SQL query for vector similarity search
      // Using pgvector's <-> operator for cosine distance
      let whereClause = '';
      const params: any[] = [JSON.stringify(queryEmbedding), limit];

      if (filters) {
        const conditions = [];
        if (filters.warehouseId) {
          conditions.push(`d."warehouseId" = $${params.length + 1}`);
          params.push(filters.warehouseId);
        }
        if (filters.category) {
          conditions.push(`d.category = $${params.length + 1}`);
          params.push(filters.category);
        }
        if (filters.language) {
          conditions.push(`d.language = $${params.length + 1}`);
          params.push(filters.language);
        }
        
        if (conditions.length > 0) {
          whereClause = `WHERE ${conditions.join(' AND ')}`;
        }
      }

      const query = `
        SELECT 
          c.id,
          c."documentId",
          c.content,
          c.metadata,
          d.title as "documentTitle",
          d.category,
          d."originalName",
          1 - (e.embedding <-> $1::vector) as similarity
        FROM chunks c
        JOIN embeddings e ON e."chunkId" = c.id
        JOIN documents d ON d.id = c."documentId"
        ${whereClause}
        ORDER BY e.embedding <-> $1::vector
        LIMIT $2
      `;

      const results = await prisma.$queryRawUnsafe(query, ...params);
      return results as any[];

    } catch (error) {
      console.error('Error searching similar chunks:', error);
      throw error;
    }
  }
}

// wmlab/backend/src/services/queue/index.ts
export { documentQueue, queueDocumentForProcessing } from './documentQueue';

// wmlab/backend/src/workers/queueWorker.ts
import { documentQueue } from '../services/queue';

// Start the queue worker
console.log('Starting document processing worker...');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing queue...');
  await documentQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing queue...');
  await documentQueue.close();
  process.exit(0);
});

console.log('Document processing worker is running');