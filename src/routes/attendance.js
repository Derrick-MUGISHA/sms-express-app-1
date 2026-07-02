const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Mark attendance ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/assess:
 *   post:
 *     summary: Mark student attendance for a course (Supervisor only)
 *     description: The requesting supervisor must be assigned to the course.
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId, courseId, status]
 *             properties:
 *               studentId:
 *                 type: string
 *                 description: MongoDB ObjectId of the student
 *                 example: 64f1a2b3c4d5e6f7a8b9c0d1
 *               courseId:
 *                 type: string
 *                 description: MongoDB ObjectId of the course
 *                 example: 64f1a2b3c4d5e6f7a8b9c0d2
 *               status:
 *                 type: boolean
 *                 description: "true = present, false = absent"
 *                 example: true
 *     responses:
 *       201:
 *         description: Attendance marked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Attendance marked successfully
 *                 attendance:
 *                   $ref: '#/components/schemas/AttendanceRecord'
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
 *             examples:
 *               notSupervisor:
 *                 value:
 *                   error: Forbidden: Supervisors only
 *               wrongCourse:
 *                 value:
 *                   error: You are not assigned as the supervisor for this course
 *       404:
 *         description: Course not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Course not found
 */
router.post('/assess',
  authenticate,
  isSupervisor,
  [
    body('studentId').isMongoId().withMessage('Invalid student ID format'),
    body('courseId').isMongoId().withMessage('Invalid course ID format'),
    body('status').isBoolean().withMessage('Status must be a boolean (true/false)'),
    validate,
  ],
  async (req, res) => {
    try {
      const { studentId, courseId, status } = req.body;

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const attendance = await prisma.attendance.create({
        data: { userId: studentId, courseId, supervisorId: req.user.id, status },
      });

      res.status(201).json({ message: 'Attendance marked successfully', attendance });
    } catch (error) {
      logger.error('Assess attendance error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Student — own attendance ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/my-attendance:
 *   get:
 *     summary: Get the authenticated student's full attendance history
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Attendance records ordered newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendances:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/AttendanceRecord'
 *                       - type: object
 *                         properties:
 *                           course:
 *                             type: object
 *                             properties:
 *                               courseName:
 *                                 type: string
 *                                 example: Introduction to Programming
 *                           supervisor:
 *                             type: object
 *                             properties:
 *                               email:
 *                                 type: string
 *                                 example: supervisor@example.com
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/my-attendance', authenticate, async (req, res) => {
  try {
    const attendances = await prisma.attendance.findMany({
      where: { userId: req.user.id },
      include: {
        course: { select: { courseName: true } },
        supervisor: { select: { email: true } },
      },
      orderBy: { date: 'desc' },
    });
    res.json({ attendances });
  } catch (error) {
    logger.error('Get my attendance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/attendance/my-attendance/{courseId}:
 *   get:
 *     summary: Get the authenticated student's attendance for a specific course
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
 *         description: Attendance records for the course, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendances:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/AttendanceRecord'
 *                       - type: object
 *                         properties:
 *                           course:
 *                             type: object
 *                             properties:
 *                               courseName:
 *                                 type: string
 *                           supervisor:
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
 */
router.get('/my-attendance/:courseId',
  authenticate,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const attendances = await prisma.attendance.findMany({
        where: { userId: req.user.id, courseId },
        include: {
          course: { select: { courseName: true } },
          supervisor: { select: { email: true } },
        },
        orderBy: { date: 'desc' },
      });
      res.json({ attendances });
    } catch (error) {
      logger.error('Get my attendance for course error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Supervisor — course attendance ───────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/course/{courseId}:
 *   get:
 *     summary: Get all attendance records for a course (Supervisor only — must own the course)
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
 *         description: All attendance records for the course, newest first
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attendances:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/AttendanceRecord'
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

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const attendances = await prisma.attendance.findMany({
        where: { courseId },
        include: { student: { select: { email: true } } },
        orderBy: { date: 'desc' },
      });
      res.json({ attendances });
    } catch (error) {
      logger.error('Get course attendance error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Update attendance ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/{id}:
 *   put:
 *     summary: Update an attendance record's status (Supervisor only — must own the course)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the attendance record
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: boolean
 *                 description: "true = present, false = absent"
 *                 example: false
 *     responses:
 *       200:
 *         description: Updated attendance record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AttendanceRecord'
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
 *         description: Attendance record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Attendance record not found
 */
router.put('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid attendance ID format'),
    body('status').isBoolean().withMessage('Status must be a boolean (true/false)'),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const existingRecord = await prisma.attendance.findUnique({ where: { id }, include: { course: true } });
      if (!existingRecord) return res.status(404).json({ error: 'Attendance record not found' });
      if (existingRecord.course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const attendance = await prisma.attendance.update({ where: { id }, data: { status } });
      res.json(attendance);
    } catch (error) {
      logger.error('Update attendance error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Delete attendance ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/{id}:
 *   delete:
 *     summary: Delete an attendance record (Supervisor only — must own the course)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the attendance record
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: Attendance record deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Attendance deleted successfully
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
 *         description: Attendance record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid attendance ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      const existingRecord = await prisma.attendance.findUnique({ where: { id }, include: { course: true } });
      if (!existingRecord) return res.status(404).json({ error: 'Attendance record not found' });
      if (existingRecord.course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      await prisma.attendance.delete({ where: { id } });
      res.json({ message: 'Attendance deleted successfully' });
    } catch (error) {
      logger.error('Delete attendance error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
