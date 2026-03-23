const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Course:
 *       type: object
 *       required:
 *         - courseName
 *         - description
 *       properties:
 *         courseName:
 *           type: string
 *         description:
 *           type: string
 */

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
 *             $ref: '#/components/schemas/Course'
 *     responses:
 *       201:
 *         description: Course created
 */
router.post('/', 
  authenticate, 
  isSupervisor,
  [
    body('courseName').trim().notEmpty().withMessage('Course name is required').isLength({ max: 100 }),
    body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 500 }),
    validate
  ],
  async (req, res) => {
    try {
      const { courseName, description } = req.body;
      const course = await prisma.course.create({ 
        data: { 
          courseName, 
          description,
          supervisorId: req.user.id 
        } 
      });
      res.status(201).json(course);
    } catch (error) {
      logger.error('Create course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/courses:
 *   get:
 *     summary: Get all courses
 *     tags: [Shared / Public]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all courses
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const courses = await prisma.course.findMany();
    res.json(courses);
  } catch (error) {
    logger.error('Get courses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/courses/{id}:
 *   get:
 *     summary: Get a course by ID
 *     tags: [Shared / Public]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course object
 *       404:
 *         description: Course not found
 */
router.get('/:id', 
  authenticate, 
  [
    param('id').isMongoId().withMessage('Invalid course ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const course = await prisma.course.findUnique({ where: { id } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      res.json(course);
    } catch (error) {
      logger.error('Get course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/courses/{id}:
 *   put:
 *     summary: Update a course (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
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
 *             $ref: '#/components/schemas/Course'
 *     responses:
 *       200:
 *         description: Course updated
 */
router.put('/:id', 
  authenticate, 
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid course ID format'),
    body('courseName').optional().trim().notEmpty().withMessage('Course name cannot be empty').isLength({ max: 100 }),
    body('description').optional().trim().notEmpty().withMessage('Description cannot be empty').isLength({ max: 500 }),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { courseName, description } = req.body;
      
      const course = await prisma.course.findUnique({ where: { id } });
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
});

/**
 * @swagger
 * /api/courses/{id}:
 *   delete:
 *     summary: Delete a course (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course deleted
 */
router.delete('/:id', 
  authenticate, 
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid course ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const course = await prisma.course.findUnique({ where: { id } });
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
});

module.exports = router;