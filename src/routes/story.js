const express = require('express');
const { body, param } = require('express-validator');
const prisma = require('../config/db');
const { validate } = require('../middleware/validate');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/stories:
 *   post:
 *     summary: Create a new story (public — no authentication required)
 *     tags: [Public Stories]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StoryInput'
 *     responses:
 *       201:
 *         description: Story created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoryResponse'
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/',
  [
    body('authorName').trim().notEmpty().withMessage('Author name is required').isLength({ max: 100 }),
    body('content').trim().notEmpty().withMessage('Story content is required').isLength({ max: 5000 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { authorName, content } = req.body;
      const story = await prisma.story.create({ data: { authorName, content } });
      res.status(201).json(story);
    } catch (error) {
      logger.error('Create story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/stories:
 *   get:
 *     summary: Retrieve all stories (public — no authentication required)
 *     tags: [Public Stories]
 *     security: []
 *     responses:
 *       200:
 *         description: Array of stories ordered newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StoryResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res) => {
  try {
    const stories = await prisma.story.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(stories);
  } catch (error) {
    logger.error('Get all stories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get by ID ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/stories/{id}:
 *   get:
 *     summary: Retrieve a single story by ID (public)
 *     tags: [Public Stories]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the story
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Story object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoryResponse'
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Story not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Story not found
 */
router.get('/:id',
  [
    param('id').isMongoId().withMessage('Invalid story ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const story = await prisma.story.findUnique({ where: { id: req.params.id } });
      if (!story) return res.status(404).json({ error: 'Story not found' });
      res.json(story);
    } catch (error) {
      logger.error('Get single story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/stories/{id}:
 *   put:
 *     summary: Update a story (public)
 *     tags: [Public Stories]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               authorName:
 *                 type: string
 *                 maxLength: 100
 *               content:
 *                 type: string
 *                 maxLength: 5000
 *     responses:
 *       200:
 *         description: Updated story
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoryResponse'
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Story not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Story not found
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
router.put('/:id',
  [
    param('id').isMongoId().withMessage('Invalid story ID format'),
    body('authorName').optional().trim().notEmpty().withMessage('Author name cannot be empty').isLength({ max: 100 }),
    body('content').optional().trim().notEmpty().withMessage('Story content cannot be empty').isLength({ max: 5000 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { authorName, content } = req.body;
      // Update directly — catch P2025 for a 404 instead of doing a findUnique first
      const story = await prisma.story.update({
        where: { id: req.params.id },
        data: { authorName, content },
      });
      res.json(story);
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Story not found' });
      }
      logger.error('Update story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/stories/{id}:
 *   delete:
 *     summary: Delete a story (public)
 *     tags: [Public Stories]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Story deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Story deleted successfully
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       404:
 *         description: Story not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Story not found
 */
router.delete('/:id',
  [
    param('id').isMongoId().withMessage('Invalid story ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      // Delete directly — catch P2025 for a 404 instead of doing a findUnique first
      await prisma.story.delete({ where: { id: req.params.id } });
      res.json({ message: 'Story deleted successfully' });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({ error: 'Story not found' });
      }
      logger.error('Delete story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
