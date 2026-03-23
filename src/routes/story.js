const express = require('express');
const { body, param } = require('express-validator');
const prisma = require('../config/db');
const { validate } = require('../middleware/validate');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Public Stories
 *   description: Open CRUD endpoints for user stories (No Authentication)
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Story:
 *       type: object
 *       required:
 *         - authorName
 *         - content
 *       properties:
 *         authorName:
 *           type: string
 *         content:
 *           type: string
 */

/**
 * @swagger
 * /api/stories:
 *   post:
 *     summary: Create a new story
 *     tags: [Public Stories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Story'
 *     responses:
 *       201:
 *         description: Story created successfully
 */
router.post('/',
  [
    body('authorName').trim().notEmpty().withMessage('Author name is required').isLength({ max: 100 }),
    body('content').trim().notEmpty().withMessage('Story content is required').isLength({ max: 5000 }),
    validate
  ],
  async (req, res) => {
    try {
      const { authorName, content } = req.body;
      const story = await prisma.story.create({
        data: { authorName, content }
      });
      res.status(201).json(story);
    } catch (error) {
      logger.error('Create story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/stories:
 *   get:
 *     summary: Retrieve all stories
 *     tags: [Public Stories]
 *     responses:
 *       200:
 *         description: A list of stories
 */
router.get('/', async (req, res) => {
  try {
    const stories = await prisma.story.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(stories);
  } catch (error) {
    logger.error('Get all stories error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/stories/{id}:
 *   get:
 *     summary: Retrieve a single story by ID
 *     tags: [Public Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A single story
 *       404:
 *         description: Story not found
 */
router.get('/:id',
  [
    param('id').isMongoId().withMessage('Invalid story ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const story = await prisma.story.findUnique({ where: { id } });
      
      if (!story) return res.status(404).json({ error: 'Story not found' });
      res.json(story);
    } catch (error) {
      logger.error('Get single story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/stories/{id}:
 *   put:
 *     summary: Update an existing story
 *     tags: [Public Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Story'
 *     responses:
 *       200:
 *         description: Story updated successfully
 *       404:
 *         description: Story not found
 */
router.put('/:id',
  [
    param('id').isMongoId().withMessage('Invalid story ID format'),
    body('authorName').optional().trim().notEmpty().withMessage('Author name cannot be empty').isLength({ max: 100 }),
    body('content').optional().trim().notEmpty().withMessage('Story content cannot be empty').isLength({ max: 5000 }),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { authorName, content } = req.body;
      
      const story = await prisma.story.findUnique({ where: { id } });
      if (!story) return res.status(404).json({ error: 'Story not found' });

      const updatedStory = await prisma.story.update({
        where: { id },
        data: { authorName, content }
      });
      res.json(updatedStory);
    } catch (error) {
      logger.error('Update story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/stories/{id}:
 *   delete:
 *     summary: Delete a story
 *     tags: [Public Stories]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Story deleted successfully
 *       404:
 *         description: Story not found
 */
router.delete('/:id',
  [
    param('id').isMongoId().withMessage('Invalid story ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const story = await prisma.story.findUnique({ where: { id } });
      if (!story) return res.status(404).json({ error: 'Story not found' });

      await prisma.story.delete({ where: { id } });
      res.json({ message: 'Story deleted successfully' });
    } catch (error) {
      logger.error('Delete story error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
