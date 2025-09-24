// backend/src/routes/search.routes.ts

import { Router } from 'express';
import { body, query, param } from 'express-validator';
import { SearchController } from '../controllers/search.controller';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { rateLimiter } from '../middleware/rateLimiter';

const router = Router();
const searchController = new SearchController();

// Apply authentication to all search routes
router.use(authenticate);

// Rate limiting for search endpoints
const searchRateLimit = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: 'Too many search requests, please try again later'
});

const aiRateLimit = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 AI requests per minute
  message: 'Too many AI requests, please try again later'
});

/**
 * @route   POST /api/search
 * @desc    Perform semantic search
 * @access  Private (all authenticated users)
 */
router.post(
  '/',
  searchRateLimit,
  [
    body('query')
      .notEmpty().withMessage('Query is required')
      .isString().withMessage('Query must be a string')
      .trim()
      .isLength({ min: 2, max: 500 }).withMessage('Query must be between 2 and 500 characters'),
    body('language')
      .optional()
      .isIn(['ar', 'en', 'de']).withMessage('Language must be ar, en, or de'),
    body('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    body('offset')
      .optional()
      .isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    body('filters')
      .optional()
      .isObject().withMessage('Filters must be an object'),
    body('filters.departmentId')
      .optional()
      .isUUID().withMessage('Department ID must be a valid UUID'),
    body('filters.warehouseId')
      .optional()
      .isUUID().withMessage('Warehouse ID must be a valid UUID'),
    body('filters.documentType')
      .optional()
      .isIn(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'image']).withMessage('Invalid document type'),
    body('filters.dateFrom')
      .optional()
      .isISO8601().withMessage('Date from must be a valid ISO date'),
    body('filters.dateTo')
      .optional()
      .isISO8601().withMessage('Date to must be a valid ISO date'),
    body('filters.tags')
      .optional()
      .isArray().withMessage('Tags must be an array'),
    body('filters.categories')
      .optional()
      .isArray().withMessage('Categories must be an array'),
    body('includeAnswer')
      .optional()
      .isBoolean().withMessage('Include answer must be a boolean'),
    body('includeMetadata')
      .optional()
      .isBoolean().withMessage('Include metadata must be a boolean'),
    body('stream')
      .optional()
      .isBoolean().withMessage('Stream must be a boolean')
  ],
  searchController.search
);

/**
 * @route   POST /api/search/advanced
 * @desc    Perform advanced search with multiple queries
 * @access  Private
 */
router.post(
  '/advanced',
  searchRateLimit,
  [
    body('queries')
      .isArray({ min: 1, max: 5 }).withMessage('Queries must be an array with 1-5 items'),
    body('queries.*.text')
      .notEmpty().withMessage('Query text is required')
      .isString()
      .trim()
      .isLength({ min: 2, max: 500 }),
    body('strategy')
      .optional()
      .isIn(['best', 'average', 'all']).withMessage('Invalid strategy'),
    body('combineResults')
      .optional()
      .isBoolean()
  ],
  searchController.advancedSearch
);

/**
 * @route   POST /api/search/document/:documentId
 * @desc    Search within a specific document
 * @access  Private
 */
router.post(
  '/document/:documentId',
  searchRateLimit,
  [
    param('documentId')
      .isUUID().withMessage('Document ID must be a valid UUID'),
    body('query')
      .notEmpty().withMessage('Query is required')
      .isString()
      .trim()
      .isLength({ min: 2, max: 500 }),
    body('limit')
      .optional()
      .isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20')
  ],
  searchController.searchInDocument
);

/**
 * @route   GET /api/search/similar/:documentId
 * @desc    Find similar documents
 * @access  Private
 */
router.get(
  '/similar/:documentId',
  searchRateLimit,
  [
    param('documentId')
      .isUUID().withMessage('Document ID must be a valid UUID'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 10 }).withMessage('Limit must be between 1 and 10')
  ],
  searchController.findSimilar
);

/**
 * @route   POST /api/search/answer
 * @desc    Generate AI-powered answer
 * @access  Private
 */
router.post(
  '/answer',
  aiRateLimit,
  [
    body('query')
      .notEmpty().withMessage('Query is required')
      .isString()
      .trim()
      .isLength({ min: 5, max: 1000 }).withMessage('Query must be between 5 and 1000 characters'),
    body('context')
      .optional()
      .isString()
      .isLength({ max: 5000 }).withMessage('Context must not exceed 5000 characters'),
    body('language')
      .optional()
      .isIn(['ar', 'en', 'de']).withMessage('Language must be ar, en, or de'),
    body('type')
      .optional()
      .isIn(['qa', 'summary', 'explanation', 'troubleshooting', 'safety'])
      .withMessage('Invalid answer type'),
    body('conversationId')
      .optional()
      .isUUID().withMessage('Conversation ID must be a valid UUID'),
    body('stream')
      .optional()
      .isBoolean()
  ],
  searchController.generateAIAnswer
);

/**
 * @route   GET /api/search/suggestions
 * @desc    Get autocomplete suggestions
 * @access  Private
 */
router.get(
  '/suggestions',
  searchRateLimit,
  [
    query('q')
      .notEmpty().withMessage('Query is required')
      .isString()
      .trim()
      .isLength({ min: 2, max: 50 }).withMessage('Query must be between 2 and 50 characters'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 10 }).withMessage('Limit must be between 1 and 10')
  ],
  searchController.getSuggestions
);

/**
 * @route   GET /api/search/history
 * @desc    Get user's search history
 * @access  Private
 */
router.get(
  '/history',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('offset')
      .optional()
      .isInt({ min: 0 }).withMessage('Offset must be non-negative')
  ],
  searchController.getSearchHistory
);

/**
 * @route   DELETE /api/search/cache
 * @desc    Clear search cache (admin only)
 * @access  Private (admin only)
 */
router.delete(
  '/cache',
  authorize(['admin']),
  [
    query('pattern')
      .optional()
      .isString()
      .matches(/^[a-zA-Z0-9:*]+$/).withMessage('Invalid cache pattern')
  ],
  searchController.clearCache
);

/**
 * @route   GET /api/search/analytics
 * @desc    Get search analytics (admin/supervisor)
 * @access  Private (admin/supervisor)
 */
router.get(
  '/analytics',
  authorize(['admin', 'supervisor']),
  [
    query('days')
      .optional()
      .isInt({ min: 1, max: 90 }).withMessage('Days must be between 1 and 90')
  ],
  searchController.getAnalytics
);

/**
 * @route   POST /api/search/feedback
 * @desc    Submit search feedback
 * @access  Private
 */
router.post(
  '/feedback',
  [
    body('searchId')
      .notEmpty().withMessage('Search ID is required')
      .isUUID().withMessage('Search ID must be a valid UUID'),
    body('resultId')
      .optional()
      .isUUID().withMessage('Result ID must be a valid UUID'),
    body('rating')
      .isIn(['helpful', 'not_helpful']).withMessage('Rating must be helpful or not_helpful'),
    body('comment')
      .optional()
      .isString()
      .isLength({ max: 500 }).withMessage('Comment must not exceed 500 characters')
  ],
  async (req, res, next) => {
    try {
      // Log feedback for improving search
      const { searchId, resultId, rating, comment } = req.body;
      const userId = (req as any).user.id;

      // This would save to database
      res.json({
        success: true,
        message: 'Feedback submitted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/search/trending
 * @desc    Get trending searches
 * @access  Private
 */
router.get(
  '/trending',
  async (req, res, next) => {
    try {
      // This would query the database for trending searches
      const trending = [
        { query: 'forklift safety procedures', count: 156 },
        { query: 'error code E-102', count: 89 },
        { query: 'inventory management', count: 67 },
        { query: 'shipping documentation', count: 45 },
        { query: 'equipment maintenance schedule', count: 34 }
      ];

      res.json({
        success: true,
        data: trending
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   POST /api/search/voice
 * @desc    Process voice search
 * @access  Private
 */
router.post(
  '/voice',
  searchRateLimit,
  [
    body('audio')
      .notEmpty().withMessage('Audio data is required'),
    body('language')
      .optional()
      .isIn(['ar', 'en', 'de']).withMessage('Language must be ar, en, or de')
  ],
  async (req, res, next) => {
    try {
      // This would process audio and convert to text
      // For now, return mock response
      res.json({
        success: true,
        data: {
          transcript: 'How to fix error E-102',
          confidence: 0.95,
          language: 'en'
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   GET /api/search/departments/:departmentId
 * @desc    Get popular searches for a department
 * @access  Private
 */
router.get(
  '/departments/:departmentId',
  [
    param('departmentId')
      .isUUID().withMessage('Department ID must be a valid UUID')
  ],
  async (req, res, next) => {
    try {
      const { departmentId } = req.params;
      
      // This would query department-specific searches
      res.json({
        success: true,
        data: {
          popular: [],
          recent: [],
          recommended: []
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;