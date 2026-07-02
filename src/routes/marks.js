const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor, isVerified } = require('../middleware/auth');
const { sendEmail } = require('../services/email.service');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Tags ─────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Marks & Assignments
 *   description: Mark and assignment management (create, read, update, delete)
 */

// ─── Create mark ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/marks:
 *   post:
 *     summary: Record a mark or assignment score for a student (Supervisor only)
 *     description: |
 *       The supervisor must be assigned to the course. The student receives an email
 *       notification with their score and any feedback provided.
 *     tags: [Marks & Assignments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/MarkInput'
 *     responses:
 *       201:
 *         description: Mark recorded — student notified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Mark recorded successfully
 *                 mark:
 *                   $ref: '#/components/schemas/MarkResponse'
 *       400:
 *         description: Validation error or score exceeds maxScore
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
 *         description: Supervisor role required, or not assigned to this course
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Course or student not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/',
  authenticate,
  isSupervisor,
  [
    body('studentId').isMongoId().withMessage('Invalid student ID format'),
    body('courseId').isMongoId().withMessage('Invalid course ID format'),
    body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
    body('score').isFloat({ min: 0 }).withMessage('Score must be a non-negative number'),
    body('maxScore').isFloat({ min: 1 }).withMessage('maxScore must be at least 1'),
    body('type').optional().isIn(['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION'])
      .withMessage('type must be one of ASSIGNMENT, QUIZ, EXAM, PROJECT, PARTICIPATION'),
    body('feedback').optional().trim().isLength({ max: 1000 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { studentId, courseId, title, score, maxScore, type, feedback } = req.body;

      if (score > maxScore) {
        return res.status(400).json({ error: 'score cannot exceed maxScore' });
      }

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const student = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true, email: true } });
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const mark = await prisma.mark.create({
        data: {
          userId: studentId,
          courseId,
          supervisorId: req.user.id,
          title,
          score,
          maxScore,
          type: type || 'ASSIGNMENT',
          feedback,
        },
      });

      const percentage = ((score / maxScore) * 100).toFixed(1);
      sendEmail(
        student.email,
        `New mark recorded: ${title} — ${course.courseName}`,
        `Your ${type || 'ASSIGNMENT'} "${title}" for ${course.courseName} has been graded: ${score}/${maxScore} (${percentage}%).${feedback ? ` Feedback: ${feedback}` : ''}`,
        `<h3>Mark Recorded</h3>
         <p>Your <strong>${type || 'ASSIGNMENT'}</strong> "<strong>${title}</strong>" for <strong>${course.courseName}</strong> has been graded.</p>
         <p>Score: <strong>${score} / ${maxScore} (${percentage}%)</strong></p>
         ${feedback ? `<p>Feedback: ${feedback}</p>` : ''}`
      ).catch(err => logger.error('Mark notification email error:', err));

      res.status(201).json({ message: 'Mark recorded successfully', mark });
    } catch (error) {
      logger.error('Create mark error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Get marks for a course (Supervisor) ─────────────────────────────────────

/**
 * @swagger
 * /api/marks/course/{courseId}:
 *   get:
 *     summary: Get all marks for a course (Supervisor only — must own the course)
 *     tags: [Marks & Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [ASSIGNMENT, QUIZ, EXAM, PROJECT, PARTICIPATION]
 *         description: Filter by mark type (optional)
 *     responses:
 *       200:
 *         description: List of marks for the course
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 marks:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/MarkResponse'
 *                       - type: object
 *                         properties:
 *                           student:
 *                             type: object
 *                             properties:
 *                               email:
 *                                 type: string
 *       400:
 *         description: Invalid course ID format
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
 *         description: Supervisor role required, or not assigned to this course
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
router.get('/course/:courseId',
  authenticate,
  isSupervisor,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { type } = req.query;

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const where = { courseId };
      if (type && ['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION'].includes(type)) {
        where.type = type;
      }

      const marks = await prisma.mark.findMany({
        where,
        include: { student: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ marks });
    } catch (error) {
      logger.error('Get course marks error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Student — own marks ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/marks/my-marks:
 *   get:
 *     summary: Get the authenticated student's full marks history
 *     tags: [Marks & Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: courseId
 *         schema:
 *           type: string
 *         description: Filter by course (optional)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [ASSIGNMENT, QUIZ, EXAM, PROJECT, PARTICIPATION]
 *         description: Filter by mark type (optional)
 *     responses:
 *       200:
 *         description: Student's marks, newest first, with per-course summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 marks:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/MarkResponse'
 *                       - type: object
 *                         properties:
 *                           course:
 *                             type: object
 *                             properties:
 *                               courseName:
 *                                 type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalRecords:
 *                       type: integer
 *                       example: 10
 *                     averageScore:
 *                       type: number
 *                       format: float
 *                       example: 78.5
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/my-marks', authenticate, async (req, res) => {
  try {
    const { courseId, type } = req.query;
    const where = { userId: req.user.id };

    if (courseId) where.courseId = courseId;
    if (type && ['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION'].includes(type)) {
      where.type = type;
    }

    const marks = await prisma.mark.findMany({
      where,
      include: { course: { select: { courseName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalRecords = marks.length;
    const averageScore = totalRecords > 0
      ? parseFloat((marks.reduce((sum, m) => sum + (m.score / m.maxScore) * 100, 0) / totalRecords).toFixed(2))
      : 0;

    res.json({ marks, summary: { totalRecords, averageScore } });
  } catch (error) {
    logger.error('Get my marks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Update mark ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/marks/{id}:
 *   put:
 *     summary: Update a mark record (Supervisor only — must own the course)
 *     description: The student is notified of the updated score by email.
 *     tags: [Marks & Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the mark record
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 200
 *               score:
 *                 type: number
 *                 minimum: 0
 *               maxScore:
 *                 type: number
 *                 minimum: 1
 *               type:
 *                 type: string
 *                 enum: [ASSIGNMENT, QUIZ, EXAM, PROJECT, PARTICIPATION]
 *               feedback:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Updated mark record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MarkResponse'
 *       400:
 *         description: Validation error or score exceeds maxScore
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
 *         description: Supervisor role required, or not assigned to this course
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Mark record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid mark ID format'),
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty').isLength({ max: 200 }),
    body('score').optional().isFloat({ min: 0 }).withMessage('Score must be a non-negative number'),
    body('maxScore').optional().isFloat({ min: 1 }).withMessage('maxScore must be at least 1'),
    body('type').optional().isIn(['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION']),
    body('feedback').optional().trim().isLength({ max: 1000 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, score, maxScore, type, feedback } = req.body;

      const existing = await prisma.mark.findUnique({
        where: { id },
        include: { course: true, student: { select: { email: true } } },
      });
      if (!existing) return res.status(404).json({ error: 'Mark record not found' });
      if (existing.course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const newScore = score !== undefined ? score : existing.score;
      const newMaxScore = maxScore !== undefined ? maxScore : existing.maxScore;
      if (newScore > newMaxScore) {
        return res.status(400).json({ error: 'score cannot exceed maxScore' });
      }

      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (score !== undefined) updateData.score = score;
      if (maxScore !== undefined) updateData.maxScore = maxScore;
      if (type !== undefined) updateData.type = type;
      if (feedback !== undefined) updateData.feedback = feedback;

      const mark = await prisma.mark.update({ where: { id }, data: updateData });

      const percentage = ((newScore / newMaxScore) * 100).toFixed(1);
      sendEmail(
        existing.student.email,
        `Mark updated: ${existing.title} — ${existing.course.courseName}`,
        `Your mark for "${existing.title}" has been updated to ${newScore}/${newMaxScore} (${percentage}%).`,
        `<h3>Mark Updated</h3>
         <p>Your mark for <strong>"${existing.title}"</strong> in <strong>${existing.course.courseName}</strong> has been updated.</p>
         <p>New score: <strong>${newScore} / ${newMaxScore} (${percentage}%)</strong></p>
         ${feedback ? `<p>Feedback: ${feedback}</p>` : ''}`
      ).catch(err => logger.error('Mark update email error:', err));

      res.json(mark);
    } catch (error) {
      logger.error('Update mark error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Delete mark ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/marks/{id}:
 *   delete:
 *     summary: Delete a mark record (Supervisor only — must own the course)
 *     tags: [Marks & Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the mark record
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Mark deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Mark deleted successfully
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
 *         description: Supervisor role required, or not assigned to this course
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Mark record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid mark ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      const existing = await prisma.mark.findUnique({
        where: { id },
        include: { course: { select: { supervisorId: true } } },
      });
      if (!existing) return res.status(404).json({ error: 'Mark record not found' });
      if (existing.course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      await prisma.mark.delete({ where: { id } });
      res.json({ message: 'Mark deleted successfully' });
    } catch (error) {
      logger.error('Delete mark error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Single mark by ID ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/marks/{id}:
 *   get:
 *     summary: Get a single mark record by ID (authenticated users — students only see their own)
 *     tags: [Marks & Assignments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the mark record
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Mark record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MarkResponse'
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
 *         description: Access denied — students can only view their own marks
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Mark record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id',
  authenticate,
  [
    param('id').isMongoId().withMessage('Invalid mark ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const mark = await prisma.mark.findUnique({ where: { id } });
      if (!mark) return res.status(404).json({ error: 'Mark record not found' });

      if (req.user.role !== 'SUPERVISOR' && mark.userId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json(mark);
    } catch (error) {
      logger.error('Get mark error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
