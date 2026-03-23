const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Student Area
 *   description: Endpoints for enrolled students
 */

/**
 * @swagger
 * /api/enrollments/{courseId}:
 *   post:
 *     summary: Enroll current user in a course
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Successfully enrolled
 */
router.post('/:courseId', 
  authenticate, 
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });

      const enrollment = await prisma.enrollment.create({
        data: {
          userId: req.user.id,
          courseId: courseId
        }
      });

      res.status(201).json({ message: 'Successfully enrolled', enrollment });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'You are already enrolled in this course' });
      }
      res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/enrollments/my-enrollments:
 *   get:
 *     summary: Get current user's enrollments
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of enrolled courses
 */
router.get('/my-enrollments', authenticate, async (req, res) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user.id },
      include: {
        course: true
      }
    });
    res.json({ enrollments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/enrollments/{courseId}:
 *   delete:
 *     summary: Unenroll from a course
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully unenrolled
 */
router.delete('/:courseId', 
  authenticate,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      
      const enrollment = await prisma.enrollment.findUnique({
        where: {
          userId_courseId: {
            userId: req.user.id,
            courseId: courseId
          }
        }
      });

      if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

      await prisma.enrollment.delete({
        where: { id: enrollment.id }
      });
      
      res.json({ message: 'Successfully unenrolled' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

module.exports = router;