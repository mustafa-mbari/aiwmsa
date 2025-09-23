// wmlab/backend/src/routes/documents.ts
import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../lib/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import crypto from 'crypto';

const router = Router();

// File upload configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'documents');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueId}${ext}`);
  }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'image/jpeg',
    'image/png'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, DOCX, XLSX, PPTX, TXT, JPG, and PNG files are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  }
});

// Document metadata schema
const createDocumentSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.enum(['SOPs', 'Safety', 'Equipment', 'Training', 'Reports', 'Other']),
  tags: z.array(z.string()).optional(),
  departmentId: z.string().optional(),
  warehouseId: z.string(),
  language: z.enum(['en', 'ar', 'de']).default('en'),
  isPublic: z.boolean().default(false)
});

// Upload single document
router.post(
  '/upload',
  authenticate,
  authorize(['Admin', 'Expert']),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const metadata = createDocumentSchema.parse(req.body);
      const userId = (req as any).user.userId;

      // Create document record
      const document = await prisma.document.create({
        data: {
          title: metadata.title,
          description: metadata.description,
          category: metadata.category,
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          path: req.file.path,
          language: metadata.language,
          isPublic: metadata.isPublic,
          uploadedById: userId,
          warehouseId: metadata.warehouseId,
          departmentId: metadata.departmentId,
          status: 'pending', // pending, processing, completed, failed
          metadata: {
            tags: metadata.tags || [],
            uploadDate: new Date().toISOString()
          }
        },
        include: {
          uploadedBy: {
            select: { id: true, email: true, name: true }
          },
          warehouse: true,
          department: true
        }
      });

      // Queue for processing (will be implemented)
      await queueDocumentForProcessing(document.id);

      res.status(201).json({
        message: 'Document uploaded successfully',
        document
      });
    } catch (error) {
      console.error('Upload error:', error);
      
      // Clean up uploaded file on error
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to upload document' 
      });
    }
  }
);

// Batch upload
router.post(
  '/upload/batch',
  authenticate,
  authorize(['Admin', 'Expert']),
  upload.array('files', 10), // Max 10 files at once
  async (req: Request, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const metadata = createDocumentSchema.parse(req.body);
      const userId = (req as any).user.userId;

      const documents = await Promise.all(
        files.map(async (file) => {
          const document = await prisma.document.create({
            data: {
              title: `${metadata.title} - ${file.originalname}`,
              description: metadata.description,
              category: metadata.category,
              filename: file.filename,
              originalName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              path: file.path,
              language: metadata.language,
              isPublic: metadata.isPublic,
              uploadedById: userId,
              warehouseId: metadata.warehouseId,
              departmentId: metadata.departmentId,
              status: 'pending',
              metadata: {
                tags: metadata.tags || [],
                uploadDate: new Date().toISOString()
              }
            }
          });

          await queueDocumentForProcessing(document.id);
          return document;
        })
      );

      res.status(201).json({
        message: `${documents.length} documents uploaded successfully`,
        documents
      });
    } catch (error) {
      // Clean up uploaded files on error
      const files = req.files as Express.Multer.File[];
      if (files) {
        await Promise.all(
          files.map(file => fs.unlink(file.path).catch(() => {}))
        );
      }

      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to upload documents' 
      });
    }
  }
);

// Get upload progress
router.get(
  '/upload/progress/:documentId',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;

      const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          status: true,
          processingProgress: true,
          processingError: true,
          chunks: {
            select: { id: true }
          }
        }
      });

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      res.json({
        documentId: document.id,
        status: document.status,
        progress: document.processingProgress || 0,
        error: document.processingError,
        chunksCreated: document.chunks.length
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get upload progress' });
    }
  }
);

// Get document list with filters
router.get(
  '/',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { 
        page = '1', 
        limit = '10', 
        category, 
        status, 
        language,
        warehouseId,
        search 
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (category) where.category = category;
      if (status) where.status = status;
      if (language) where.language = language;
      if (warehouseId) where.warehouseId = warehouseId;
      if (search) {
        where.OR = [
          { title: { contains: search as string, mode: 'insensitive' } },
          { description: { contains: search as string, mode: 'insensitive' } }
        ];
      }

      const [documents, total] = await Promise.all([
        prisma.document.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { createdAt: 'desc' },
          include: {
            uploadedBy: {
              select: { id: true, email: true, name: true }
            },
            warehouse: true,
            department: true,
            _count: {
              select: { chunks: true }
            }
          }
        }),
        prisma.document.count({ where })
      ]);

      res.json({
        documents,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  }
);

// Delete document
router.delete(
  '/:id',
  authenticate,
  authorize(['Admin']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const document = await prisma.document.findUnique({
        where: { id }
      });

      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      // Delete file from storage
      await fs.unlink(document.path).catch(() => {});

      // Delete from database (cascades to chunks and embeddings)
      await prisma.document.delete({
        where: { id }
      });

      res.json({ message: 'Document deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete document' });
    }
  }
);

// Helper function to queue document for processing
async function queueDocumentForProcessing(documentId: string) {
  // This will be implemented with Bull queue or similar
  // For now, just update status
  await prisma.document.update({
    where: { id: documentId },
    data: { 
      status: 'processing',
      processingProgress: 10
    }
  });
  
  // Trigger processing (to be implemented)
  // await documentProcessor.process(documentId);
}

export default router;