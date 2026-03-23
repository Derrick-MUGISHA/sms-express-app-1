const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor } = require('../middleware/auth');

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
      const course = await prisma.course.create({ data: { courseName, description } });
      res.status(201).json(course);
    } catch (error) {
      res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
      res.status(500).json({ error: error.message });
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
      const course = await prisma.course.update({
        where: { id },
        data: { courseName, description },
      });
      res.json(course);
    } catch (error) {
      res.status(500).json({ error: error.message });
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
      await prisma.course.delete({ where: { id } });
      res.json({ message: 'Course deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

module.exports = router;