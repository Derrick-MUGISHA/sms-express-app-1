const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor, isVerified } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Supervisor — get roster for a course ────────────────────────────────────

/**
 * @swagger
 * /api/enrollments/course/{courseId}/roster:
 *   get:
 *     summary: Get the attendance roster for a course (Supervisor only — must own the course)
 *     description: |
 *       Returns every student enrolled in the course with their studentId, email,
 *       and today's attendance status (present/absent/not yet recorded).
 *       Use the studentIds from this response to call POST /api/attendance/bulk
 *       or POST /api/attendance/assess to mark attendance.
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Roster of enrolled students with today's attendance status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 courseId:
 *                   type: string
 *                 courseName:
 *                   type: string
 *                 date:
 *                   type: string
 *                   format: date
 *                   example: "2026-07-02"
 *                 roster:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       studentId:
 *                         type: string
 *                         example: 64f1a2b3c4d5e6f7a8b9c0d2
 *                       email:
 *                         type: string
 *                         example: student@example.com
 *                       todayStatus:
 *                         type: string
 *                         enum: [present, absent, not_recorded]
 *                         description: "present/absent if already marked today, not_recorded if not yet taken"
 *                         example: not_recorded
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
router.get('/course/:courseId/roster',
  authenticate,
  isSupervisor,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { user: { select: { id: true, email: true } } },
      });

      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

      const todayRecords = await prisma.attendance.findMany({
        where: {
          courseId,
          date: { gte: startOfDay, lt: endOfDay },
        },
        select: { userId: true, status: true },
      });

      const todayMap = Object.fromEntries(todayRecords.map(r => [r.userId, r.status]));

      const roster = enrollments.map(e => {
        const recorded = e.user.id in todayMap;
        return {
          studentId: e.user.id,
          email: e.user.email,
          todayStatus: recorded ? (todayMap[e.user.id] ? 'present' : 'absent') : 'not_recorded',
        };
      });

      res.json({
        courseId,
        courseName: course.courseName,
        date: startOfDay.toISOString().split('T')[0],
        roster,
      });
    } catch (error) {
      logger.error('Get roster error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Supervisor — list enrollments for a course ───────────────────────────────

/**
 * @swagger
 * /api/enrollments/course/{courseId}:
 *   get:
 *     summary: List all students enrolled in a course (Supervisor only — must own the course)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: List of enrolled students
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 courseId:
 *                   type: string
 *                 courseName:
 *                   type: string
 *                 enrolledCount:
 *                   type: integer
 *                   example: 30
 *                 students:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       studentId:
 *                         type: string
 *                         example: 64f1a2b3c4d5e6f7a8b9c0d2
 *                       email:
 *                         type: string
 *                         example: student@example.com
 *                       enrolledAt:
 *                         type: string
 *                         format: date-time
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

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const enrollments = await prisma.enrollment.findMany({
        where: { courseId },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const students = enrollments.map(e => ({
        studentId: e.user.id,
        email: e.user.email,
        enrolledAt: e.createdAt,
      }));

      res.json({ courseId, courseName: course.courseName, enrolledCount: students.length, students });
    } catch (error) {
      logger.error('Get course enrollments error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── My enrollments ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/enrollments/my-enrollments:
 *   get:
 *     summary: Get all courses the authenticated student is enrolled in
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of enrollments with course details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enrollments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *                       userId:
 *                         type: string
 *                         example: 64f1a2b3c4d5e6f7a8b9c0d2
 *                       courseId:
 *                         type: string
 *                         example: 64f1a2b3c4d5e6f7a8b9c0d3
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       course:
 *                         $ref: '#/components/schemas/CourseResponse'
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
router.get('/my-enrollments', authenticate, isVerified, async (req, res) => {
  try {
    const enrollments = await prisma.enrollment.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        userId: true,
        courseId: true,
        createdAt: true,
        course: {
          select: {
            id: true,
            courseName: true,
            description: true,
            supervisorId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    res.json({ enrollments });
  } catch (error) {
    logger.error('Get enrollments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Enroll ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/enrollments/{courseId}:
 *   post:
 *     summary: Enroll the authenticated student in a course
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       201:
 *         description: Successfully enrolled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Successfully enrolled
 *                 enrollment:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     userId:
 *                       type: string
 *                     courseId:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Already enrolled in this course, or invalid course ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               alreadyEnrolled:
 *                 value:
 *                   error: You are already enrolled in this course
 *               invalidId:
 *                 value:
 *                   error: Validation failed
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
router.post('/:courseId',
  authenticate,
  isVerified,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });

      const enrollment = await prisma.enrollment.create({
        data: { userId: req.user.id, courseId },
      });

      res.status(201).json({ message: 'Successfully enrolled', enrollment });
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(400).json({ error: 'You are already enrolled in this course' });
      }
      logger.error('Enrollment error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Unenroll ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/enrollments/{courseId}:
 *   delete:
 *     summary: Unenroll the authenticated student from a course
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the course
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Successfully unenrolled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Successfully unenrolled
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
 *         description: Email not verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Enrollment not found (not enrolled in this course)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Enrollment not found
 */
router.delete('/:courseId',
  authenticate,
  isVerified,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const enrollment = await prisma.enrollment.findUnique({
        where: { userId_courseId: { userId: req.user.id, courseId } },
      });

      if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

      await prisma.enrollment.delete({ where: { id: enrollment.id } });
      res.json({ message: 'Successfully unenrolled' });
    } catch (error) {
      logger.error('Unenroll error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
