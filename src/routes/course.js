const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor, isVerified } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/courses:
 *   post:
 *     summary: Create a new course (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CourseInput'
 *     responses:
 *       201:
 *         description: Course created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CourseResponse'
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Supervisor role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
router.post('/',
  authenticate,
  isSupervisor,
  [
    body('courseName').trim().notEmpty().withMessage('Course name is required').isLength({ max: 100 }),
    body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 500 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseName, description } = req.body;
      const course = await prisma.course.create({
        data: { courseName, description, supervisorId: req.user.id },
      });
      res.status(201).json(course);
    } catch (error) {
      logger.error('Create course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: List all courses (any authenticated verified user)
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of courses
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/CourseResponse'
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Email not verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authenticate, isVerified, async (req, res) => {
  try {
    const courses = await prisma.course.findMany();
    res.json(courses);
  } catch (error) {
    logger.error('Get courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get by ID ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/courses/{id}:
 *   get:
 *     summary: Get a course by ID (any authenticated verified user)
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Course object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CourseResponse'
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Email not verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Course not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Course not found
 */
router.get('/:id',
  authenticate,
  isVerified,
  [
    param('id').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const course = await prisma.course.findUnique({ where: { id: req.params.id } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      res.json(course);
    } catch (error) {
      logger.error('Get course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/courses/{id}:
 *   put:
 *     summary: Update a course (Supervisor only — must be the course's supervisor)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
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
 *               courseName:
 *                 type: string
 *                 maxLength: 100
 *                 example: Advanced Programming
 *               description:
 *                 type: string
 *                 maxLength: 500
 *                 example: Deep dive into algorithms and data structures.
 *     responses:
 *       200:
 *         description: Updated course
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CourseResponse'
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Supervisor role required, or not the course's assigned supervisor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: You are not the supervisor of this course
 *       404:
 *         description: Course not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid course ID format'),
    body('courseName').optional().trim().notEmpty().withMessage('Course name cannot be empty').isLength({ max: 100 }),
    body('description').optional().trim().notEmpty().withMessage('Description cannot be empty').isLength({ max: 500 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { courseName, description } = req.body;

      // Fetch only what we need to check ownership — single select is faster than findUnique
      const course = await prisma.course.findUnique({ where: { id }, select: { supervisorId: true } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId && course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not the supervisor of this course' });
      }

      const updatedCourse = await prisma.course.update({
        where: { id },
        data: { courseName, description },
      });
      res.json(updatedCourse);
    } catch (error) {
      logger.error('Update course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/courses/{id}:
 *   delete:
 *     summary: Delete a course (Supervisor only — must be the course's supervisor)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Course deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Course deleted successfully
 *       400:
 *         description: Invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Supervisor role required, or not the course's assigned supervisor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Course not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      const course = await prisma.course.findUnique({ where: { id }, select: { supervisorId: true } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId && course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not the supervisor of this course' });
      }

      await prisma.course.delete({ where: { id } });
      res.json({ message: 'Course deleted successfully' });
    } catch (error) {
      logger.error('Delete course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
