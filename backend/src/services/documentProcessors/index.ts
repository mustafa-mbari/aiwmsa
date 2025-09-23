// wmlab/backend/src/services/documentProcessors/index.ts
import { PDFProcessor } from './pdfProcessor';
import { ExcelProcessor } from './excelProcessor';
import { WordProcessor } from './wordProcessor';
import { TextProcessor } from './textProcessor';
import { ImageProcessor } from './imageProcessor';
import { prisma } from '../../lib/prisma';
import path from 'path';

export interface ProcessorResult {
  text: string;
  metadata: Record<string, any>;
  pages?: number;
  tables?: any[];
  images?: string[];
}

export interface DocumentChunk {
  text: string;
  metadata: {
    page?: number;
    section?: string;
    type: 'text' | 'table' | 'image' | 'heading';
    language?: string;
  };
}

export class DocumentProcessor {
  private processors: Map<string, any>;

  constructor() {
    this.processors = new Map([
      ['application/pdf', new PDFProcessor()],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new ExcelProcessor()],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new WordProcessor()],
      ['text/plain', new TextProcessor()],
      ['image/jpeg', new ImageProcessor()],
      ['image/png', new ImageProcessor()]
    ]);
  }

  async process(documentId: string): Promise<void> {
    try {
      // Get document from database
      const document = await prisma.document.findUnique({
        where: { id: documentId }
      });

      if (!document) {
        throw new Error('Document not found');
      }

      // Update status to processing
      await prisma.document.update({
        where: { id: documentId },
        data: { 
          status: 'processing',
          processingProgress: 20
        }
      });

      // Get appropriate processor
      const processor = this.processors.get(document.mimeType);
      if (!processor) {
        throw new Error(`No processor available for ${document.mimeType}`);
      }

      // Extract text and metadata
      const result: ProcessorResult = await processor.process(document.path);

      // Update progress
      await prisma.document.update({
        where: { id: documentId },
        data: { processingProgress: 50 }
      });

      // Create chunks
      const chunks = await this.createChunks(result.text, result.metadata);

      // Save chunks to database
      await this.saveChunks(documentId, chunks);

      // Update progress
      await prisma.document.update({
        where: { id: documentId },
        data: { processingProgress: 80 }
      });

      // Generate embeddings (to be implemented)
      await this.generateEmbeddings(documentId, chunks);

      // Update document status
      await prisma.document.update({
        where: { id: documentId },
        data: { 
          status: 'completed',
          processingProgress: 100,
          extractedText: result.text.substring(0, 5000), // Store preview
          metadata: {
            ...document.metadata as any,
            ...result.metadata,
            processedAt: new Date().toISOString(),
            totalChunks: chunks.length
          }
        }
      });

    } catch (error) {
      console.error('Processing error:', error);
      
      await prisma.document.update({
        where: { id: documentId },
        data: { 
          status: 'failed',
          processingError: error instanceof Error ? error.message : 'Processing failed'
        }
      });

      throw error;
    }
  }

  private async createChunks(text: string, metadata: Record<string, any>): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const chunkSize = 1000; // Characters per chunk
    const overlap = 200; // Overlap between chunks

    // Split text into paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = '';
    let currentMetadata: any = { type: 'text' };

    for (const paragraph of paragraphs) {
      // Check if paragraph is a heading
      if (paragraph.match(/^#{1,6}\s/) || paragraph.match(/^[A-Z\s]{3,}$/)) {
        // Save current chunk if exists
        if (currentChunk.trim()) {
          chunks.push({
            text: currentChunk.trim(),
            metadata: currentMetadata
          });
        }
        
        // Start new chunk with heading
        currentChunk = paragraph;
        currentMetadata = { type: 'heading' };
      } else if (currentChunk.length + paragraph.length <= chunkSize) {
        // Add to current chunk
        currentChunk += '\n\n' + paragraph;
      } else {
        // Save current chunk and start new one
        if (currentChunk.trim()) {
          chunks.push({
            text: currentChunk.trim(),
            metadata: currentMetadata
          });
        }
        
        // Keep last part of previous chunk for context
        const overlapText = currentChunk.split(' ').slice(-30).join(' ');
        currentChunk = overlapText + '\n\n' + paragraph;
        currentMetadata = { type: 'text' };
      }
    }

    // Save last chunk
    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        metadata: currentMetadata
      });
    }

    // Add language detection
    for (const chunk of chunks) {
      chunk.metadata.language = this.detectLanguage(chunk.text);
    }

    return chunks;
  }

  private detectLanguage(text: string): 'en' | 'ar' | 'de' | 'unknown' {
    // Simple language detection based on character patterns
    const arabicPattern = /[\u0600-\u06FF]/;
    const germanPattern = /[äöüßÄÖÜ]/;
    
    if (arabicPattern.test(text)) return 'ar';
    if (germanPattern.test(text)) return 'de';
    
    // Default to English
    return 'en';
  }

  private async saveChunks(documentId: string, chunks: DocumentChunk[]): Promise<void> {
    const chunkRecords = chunks.map((chunk, index) => ({
      documentId,
      content: chunk.text,
      chunkIndex: index,
      metadata: chunk.metadata,
      tokenCount: Math.ceil(chunk.text.length / 4) // Approximate token count
    }));

    await prisma.chunk.createMany({
      data: chunkRecords
    });
  }

  private async generateEmbeddings(documentId: string, chunks: DocumentChunk[]): Promise<void> {
    // This will be implemented with OpenAI/Cohere API
    // For now, just log
    console.log(`Generating embeddings for ${chunks.length} chunks of document ${documentId}`);
    
    // Update progress
    await prisma.document.update({
      where: { id: documentId },
      data: { processingProgress: 90 }
    });
  }
}

// wmlab/backend/src/services/documentProcessors/pdfProcessor.ts
import pdf from 'pdf-parse';
import fs from 'fs/promises';
import { ProcessorResult } from './index';

export class PDFProcessor {
  async process(filePath: string): Promise<ProcessorResult> {
    try {
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdf(dataBuffer);

      return {
        text: data.text,
        metadata: {
          pages: data.numpages,
          info: data.info,
          metadata: data.metadata,
          version: data.version
        },
        pages: data.numpages
      };
    } catch (error) {
      console.error('PDF processing error:', error);
      throw new Error('Failed to process PDF file');
    }
  }
}

// wmlab/backend/src/services/documentProcessors/excelProcessor.ts
import XLSX from 'xlsx';
import { ProcessorResult } from './index';

export class ExcelProcessor {
  async process(filePath: string): Promise<ProcessorResult> {
    try {
      const workbook = XLSX.readFile(filePath);
      let fullText = '';
      const tables: any[] = [];

      // Process each sheet
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        
        // Convert to JSON for structured data
        const jsonData = XLSX.utils.sheet_to_json(sheet);
        tables.push({
          sheetName,
          data: jsonData
        });

        // Convert to CSV for text extraction
        const csvData = XLSX.utils.sheet_to_csv(sheet);
        fullText += `\n\nSheet: ${sheetName}\n${csvData}`;
      }

      return {
        text: fullText,
        metadata: {
          sheets: workbook.SheetNames,
          sheetCount: workbook.SheetNames.length
        },
        tables
      };
    } catch (error) {
      console.error('Excel processing error:', error);
      throw new Error('Failed to process Excel file');
    }
  }
}

// wmlab/backend/src/services/documentProcessors/wordProcessor.ts
import mammoth from 'mammoth';
import { ProcessorResult } from './index';

export class WordProcessor {
  async process(filePath: string): Promise<ProcessorResult> {
    try {
      const result = await mammoth.extractRawText({ path: filePath });
      
      // Also extract with HTML to preserve structure
      const htmlResult = await mammoth.convertToHtml({ path: filePath });

      return {
        text: result.value,
        metadata: {
          messages: result.messages,
          hasImages: htmlResult.value.includes('<img'),
          hasTables: htmlResult.value.includes('<table')
        }
      };
    } catch (error) {
      console.error('Word processing error:', error);
      throw new Error('Failed to process Word file');
    }
  }
}

// wmlab/backend/src/services/documentProcessors/textProcessor.ts
import fs from 'fs/promises';
import { ProcessorResult } from './index';

export class TextProcessor {
  async process(filePath: string): Promise<ProcessorResult> {
    try {
      const text = await fs.readFile(filePath, 'utf-8');

      return {
        text,
        metadata: {
          characterCount: text.length,
          lineCount: text.split('\n').length
        }
      };
    } catch (error) {
      console.error('Text processing error:', error);
      throw new Error('Failed to process text file');
    }
  }
}

// wmlab/backend/src/services/documentProcessors/imageProcessor.ts
import Tesseract from 'tesseract.js';
import { ProcessorResult } from './index';

export class ImageProcessor {
  async process(filePath: string): Promise<ProcessorResult> {
    try {
      // Use Tesseract for OCR
      const result = await Tesseract.recognize(filePath, 'eng+ara', {
        logger: (info) => console.log(info)
      });

      return {
        text: result.data.text,
        metadata: {
          confidence: result.data.confidence,
          language: result.data.language
        }
      };
    } catch (error) {
      console.error('Image processing error:', error);
      throw new Error('Failed to process image file');
    }
  }
}