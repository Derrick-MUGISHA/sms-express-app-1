const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor, isVerified } = require('../middleware/auth');
const { sendEmail } = require('../services/email.service');
const logger = require('../utils/logger');

const router = express.Router();

const ABSENCE_THRESHOLD = parseInt(process.env.ABSENCE_THRESHOLD || '3', 10);

async function notifyStudentAttendance(student, course, status) {
  const label = status ? 'PRESENT' : 'ABSENT';
  const subject = `Attendance recorded: ${course.courseName}`;
  const text = `Your attendance for ${course.courseName} has been marked as ${label}.`;
  const html = `<h3>Attendance Update</h3>
    <p>Your attendance for <strong>${course.courseName}</strong> has been recorded as <strong>${label}</strong>.</p>
    <p>If you believe this is incorrect, you can raise a claim via POST /api/attendance/claim.</p>`;
  await sendEmail(student.email, subject, text, html);
}

async function checkAndNotifyDean(studentId, courseId, course) {
  const deanEmail = process.env.DEAN_EMAIL;
  if (!deanEmail) return;

  const absences = await prisma.attendance.count({
    where: { userId: studentId, courseId, status: false },
  });

  if (absences >= ABSENCE_THRESHOLD) {
    const student = await prisma.user.findUnique({ where: { id: studentId }, select: { email: true } });
    await sendEmail(
      deanEmail,
      `Attendance Alert: ${student.email} — ${course.courseName}`,
      `Student ${student.email} has ${absences} absences in ${course.courseName} and may need to be referred to the Dean's Office.`,
      `<h3>Attendance Alert</h3>
       <p>Student <strong>${student.email}</strong> has accumulated <strong>${absences}</strong> absences in <strong>${course.courseName}</strong>.</p>
       <p>This exceeds the threshold of ${ABSENCE_THRESHOLD} and may require a referral to the Dean's Office.</p>`
    );
  }
}

// ─── Mark attendance (single) ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/assess:
 *   post:
 *     summary: Mark student attendance for a course (Supervisor only)
 *     description: |
 *       The requesting supervisor must be assigned to the course. After recording,
 *       the student receives an email notification. If the student's total absences
 *       reach the configured threshold (default 3), an alert is emailed to the
 *       Dean's Office (DEAN_EMAIL env variable).
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
 *         description: Attendance marked — student notified by email
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
 *         description: Course or student not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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

      const student = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true, email: true } });
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const attendance = await prisma.attendance.create({
        data: { userId: studentId, courseId, supervisorId: req.user.id, status },
      });

      notifyStudentAttendance(student, course, status).catch(err =>
        logger.error('Student attendance email error:', err)
      );

      if (!status) {
        checkAndNotifyDean(studentId, courseId, course).catch(err =>
          logger.error('Dean notification error:', err)
        );
      }

      res.status(201).json({ message: 'Attendance marked successfully', attendance });
    } catch (error) {
      logger.error('Assess attendance error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Bulk attendance recording ────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/bulk:
 *   post:
 *     summary: Record attendance for multiple students at once (Supervisor only)
 *     description: |
 *       Accepts an array of student/status pairs for a single course and creates
 *       all records in one operation. Each student receives an email notification.
 *       Students who reach the absence threshold trigger a Dean's Office alert.
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BulkAttendanceInput'
 *     responses:
 *       201:
 *         description: Attendance recorded for all students
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Attendance recorded for 25 students
 *                 count:
 *                   type: integer
 *                   example: 25
 *                 records:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AttendanceRecord'
 *       400:
 *         description: Validation error or empty records array
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
router.post('/bulk',
  authenticate,
  isSupervisor,
  [
    body('courseId').isMongoId().withMessage('Invalid course ID format'),
    body('records').isArray({ min: 1 }).withMessage('records must be a non-empty array'),
    body('records.*.studentId').isMongoId().withMessage('Each studentId must be a valid MongoDB ObjectId'),
    body('records.*.status').isBoolean().withMessage('Each status must be a boolean'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId, records } = req.body;

      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      if (course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const data = records.map(r => ({
        userId: r.studentId,
        courseId,
        supervisorId: req.user.id,
        status: r.status,
      }));

      await prisma.attendance.createMany({ data });

      const created = await prisma.attendance.findMany({
        where: {
          courseId,
          supervisorId: req.user.id,
          userId: { in: records.map(r => r.studentId) },
        },
        orderBy: { date: 'desc' },
        take: records.length,
      });

      const studentIds = records.map(r => r.studentId);
      const students = await prisma.user.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, email: true },
      });
      const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

      for (const r of records) {
        const student = studentMap[r.studentId];
        if (student) {
          notifyStudentAttendance(student, course, r.status).catch(err =>
            logger.error('Bulk attendance email error:', err)
          );
          if (!r.status) {
            checkAndNotifyDean(r.studentId, courseId, course).catch(err =>
              logger.error('Dean notification error:', err)
            );
          }
        }
      }

      res.status(201).json({
        message: `Attendance recorded for ${created.length} students`,
        count: created.length,
        records: created,
      });
    } catch (error) {
      logger.error('Bulk attendance error:', error);
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

// ─── Student — own attendance statistics ──────────────────────────────────────

/**
 * @swagger
 * /api/attendance/my-stats:
 *   get:
 *     summary: Get the authenticated student's overall attendance statistics
 *     description: Returns present/absent counts and attendance rate across all enrolled courses.
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Overall attendance statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stats:
 *                   $ref: '#/components/schemas/AttendanceStats'
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/my-stats', authenticate, async (req, res) => {
  try {
    const records = await prisma.attendance.findMany({
      where: { userId: req.user.id },
      select: { status: true },
    });
    const total = records.length;
    const present = records.filter(r => r.status).length;
    res.json({
      stats: {
        total,
        present,
        absent: total - present,
        attendanceRate: total > 0 ? parseFloat(((present / total) * 100).toFixed(2)) : 0,
      },
    });
  } catch (error) {
    logger.error('Get my stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/attendance/my-stats/{courseId}:
 *   get:
 *     summary: Get the authenticated student's attendance statistics for a specific course
 *     tags: [Student Area]
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
 *         description: Per-course attendance statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 courseId:
 *                   type: string
 *                 stats:
 *                   $ref: '#/components/schemas/AttendanceStats'
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
router.get('/my-stats/:courseId',
  authenticate,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const records = await prisma.attendance.findMany({
        where: { userId: req.user.id, courseId },
        select: { status: true },
      });
      const total = records.length;
      const present = records.filter(r => r.status).length;
      res.json({
        courseId,
        stats: {
          total,
          present,
          absent: total - present,
          attendanceRate: total > 0 ? parseFloat(((present / total) * 100).toFixed(2)) : 0,
        },
      });
    } catch (error) {
      logger.error('Get my stats for course error:', error);
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

// ─── Supervisor — course attendance statistics ────────────────────────────────

/**
 * @swagger
 * /api/attendance/course/{courseId}/stats:
 *   get:
 *     summary: Get attendance statistics for a course (Supervisor only — must own the course)
 *     description: Returns per-student attendance totals and an overall course summary.
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
 *         description: Course attendance statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 courseId:
 *                   type: string
 *                 courseName:
 *                   type: string
 *                 overall:
 *                   $ref: '#/components/schemas/AttendanceStats'
 *                 perStudent:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       studentId:
 *                         type: string
 *                       email:
 *                         type: string
 *                       stats:
 *                         $ref: '#/components/schemas/AttendanceStats'
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
router.get('/course/:courseId/stats',
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

      const records = await prisma.attendance.findMany({
        where: { courseId },
        include: { student: { select: { id: true, email: true } } },
      });

      const byStudent = {};
      for (const r of records) {
        const sid = r.student.id;
        if (!byStudent[sid]) byStudent[sid] = { studentId: sid, email: r.student.email, present: 0, total: 0 };
        byStudent[sid].total++;
        if (r.status) byStudent[sid].present++;
      }

      const perStudent = Object.values(byStudent).map(s => ({
        studentId: s.studentId,
        email: s.email,
        stats: {
          total: s.total,
          present: s.present,
          absent: s.total - s.present,
          attendanceRate: s.total > 0 ? parseFloat(((s.present / s.total) * 100).toFixed(2)) : 0,
        },
      }));

      const total = records.length;
      const present = records.filter(r => r.status).length;

      res.json({
        courseId,
        courseName: course.courseName,
        overall: {
          total,
          present,
          absent: total - present,
          attendanceRate: total > 0 ? parseFloat(((present / total) * 100).toFixed(2)) : 0,
        },
        perStudent,
      });
    } catch (error) {
      logger.error('Get course attendance stats error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Update attendance ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/{id}:
 *   put:
 *     summary: Correct an attendance record's status (Supervisor only — must own the course)
 *     description: Allows a supervisor to correct a previously recorded attendance status. The student is notified of the correction by email.
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

      const existingRecord = await prisma.attendance.findUnique({
        where: { id },
        include: { course: true, student: { select: { email: true } } },
      });
      if (!existingRecord) return res.status(404).json({ error: 'Attendance record not found' });
      if (existingRecord.course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }

      const attendance = await prisma.attendance.update({ where: { id }, data: { status } });

      const label = status ? 'PRESENT' : 'ABSENT';
      sendEmail(
        existingRecord.student.email,
        `Attendance correction: ${existingRecord.course.courseName}`,
        `Your attendance for ${existingRecord.course.courseName} has been corrected to ${label}.`,
        `<h3>Attendance Correction</h3>
         <p>Your attendance for <strong>${existingRecord.course.courseName}</strong> has been updated to <strong>${label}</strong> by your supervisor.</p>`
      ).catch(err => logger.error('Attendance correction email error:', err));

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

// ─── Student — claim missing attendance ──────────────────────────────────────

/**
 * @swagger
 * /api/attendance/claim:
 *   post:
 *     summary: Raise a claim for unrecorded attendance (Student)
 *     description: |
 *       A student can submit a claim when they believe they were present but
 *       their attendance was not recorded. The supervisor is notified by email
 *       and can approve or reject via PUT /api/attendance/claims/{id}.
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [courseId, date, reason]
 *             properties:
 *               courseId:
 *                 type: string
 *                 description: MongoDB ObjectId of the course
 *                 example: 64f1a2b3c4d5e6f7a8b9c0d1
 *               date:
 *                 type: string
 *                 format: date
 *                 description: The date (YYYY-MM-DD) for which attendance was missed
 *                 example: "2026-06-15"
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 example: I was present in class but the supervisor missed recording my name
 *     responses:
 *       201:
 *         description: Claim submitted — supervisor notified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Attendance claim submitted successfully
 *                 claim:
 *                   $ref: '#/components/schemas/AttendanceClaim'
 *       400:
 *         description: Validation error
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
 *       404:
 *         description: Course not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/claim',
  authenticate,
  [
    body('courseId').isMongoId().withMessage('Invalid course ID format'),
    body('date').isISO8601().withMessage('Date must be a valid ISO 8601 date'),
    body('reason').trim().notEmpty().withMessage('Reason is required').isLength({ max: 500 }),
    validate,
  ],
  async (req, res) => {
    try {
      const { courseId, date, reason } = req.body;

      const course = await prisma.course.findUnique({
        where: { id: courseId },
        include: { supervisor: { select: { email: true } } },
      });
      if (!course) return res.status(404).json({ error: 'Course not found' });

      const claim = await prisma.attendanceClaim.create({
        data: {
          userId: req.user.id,
          courseId,
          date: new Date(date),
          reason,
        },
      });

      if (course.supervisor) {
        sendEmail(
          course.supervisor.email,
          `Attendance Claim: ${course.courseName}`,
          `Student ${req.user.email} has submitted an attendance claim for ${date}. Reason: ${reason}`,
          `<h3>Attendance Claim Received</h3>
           <p>Student <strong>${req.user.email}</strong> has submitted an attendance claim for <strong>${course.courseName}</strong> on <strong>${date}</strong>.</p>
           <p>Reason: ${reason}</p>
           <p>Review and resolve this claim via PUT /api/attendance/claims/${claim.id}</p>`
        ).catch(err => logger.error('Claim supervisor email error:', err));
      }

      res.status(201).json({ message: 'Attendance claim submitted successfully', claim });
    } catch (error) {
      logger.error('Create attendance claim error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Supervisor — list all claims for own courses ─────────────────────────────

/**
 * @swagger
 * /api/attendance/claims:
 *   get:
 *     summary: List all attendance claims for the supervisor's courses (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, APPROVED, REJECTED]
 *         description: Filter by claim status (optional)
 *         example: PENDING
 *     responses:
 *       200:
 *         description: List of claims
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 claims:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/AttendanceClaim'
 *                       - type: object
 *                         properties:
 *                           student:
 *                             type: object
 *                             properties:
 *                               email:
 *                                 type: string
 *                           course:
 *                             type: object
 *                             properties:
 *                               courseName:
 *                                 type: string
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
 */
router.get('/claims', authenticate, isSupervisor, async (req, res) => {
  try {
    const { status } = req.query;

    const where = { course: { supervisorId: req.user.id } };
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      where.status = status;
    }

    const claims = await prisma.attendanceClaim.findMany({
      where,
      include: {
        student: { select: { email: true } },
        course: { select: { courseName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ claims });
  } catch (error) {
    logger.error('Get claims error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Supervisor — resolve a claim ─────────────────────────────────────────────

/**
 * @swagger
 * /api/attendance/claims/{id}:
 *   put:
 *     summary: Approve or reject an attendance claim (Supervisor only — must own the course)
 *     description: |
 *       When approved, the supervisor may optionally supply `createRecord: true` to
 *       automatically create an attendance record marking the student as present.
 *       The student is emailed the outcome.
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the claim
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
 *                 type: string
 *                 enum: [APPROVED, REJECTED]
 *                 example: APPROVED
 *               resolution:
 *                 type: string
 *                 maxLength: 500
 *                 example: Verified with class register — attendance corrected
 *               createRecord:
 *                 type: boolean
 *                 description: If true and status is APPROVED, creates a PRESENT attendance record for the claimed date
 *                 example: true
 *     responses:
 *       200:
 *         description: Claim resolved — student notified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Claim approved and attendance record created
 *                 claim:
 *                   $ref: '#/components/schemas/AttendanceClaim'
 *       400:
 *         description: Validation error or claim already resolved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
 *         description: Claim not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/claims/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid claim ID format'),
    body('status').isIn(['APPROVED', 'REJECTED']).withMessage('Status must be APPROVED or REJECTED'),
    body('resolution').optional().trim().isLength({ max: 500 }),
    body('createRecord').optional().isBoolean(),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, resolution, createRecord } = req.body;

      const claim = await prisma.attendanceClaim.findUnique({
        where: { id },
        include: {
          course: true,
          student: { select: { email: true } },
        },
      });
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      if (claim.course.supervisorId !== req.user.id) {
        return res.status(403).json({ error: 'You are not assigned as the supervisor for this course' });
      }
      if (claim.status !== 'PENDING') {
        return res.status(400).json({ error: 'This claim has already been resolved' });
      }

      const updatedClaim = await prisma.attendanceClaim.update({
        where: { id },
        data: { status, resolution, resolvedBy: req.user.id },
      });

      let attendanceRecord = null;
      if (status === 'APPROVED' && createRecord) {
        attendanceRecord = await prisma.attendance.create({
          data: {
            userId: claim.userId,
            courseId: claim.courseId,
            supervisorId: req.user.id,
            status: true,
            date: claim.date,
          },
        });
      }

      const label = status === 'APPROVED' ? 'approved' : 'rejected';
      sendEmail(
        claim.student.email,
        `Attendance claim ${label}: ${claim.course.courseName}`,
        `Your attendance claim for ${claim.course.courseName} on ${claim.date.toDateString()} has been ${label}.${resolution ? ` Note: ${resolution}` : ''}`,
        `<h3>Attendance Claim ${status === 'APPROVED' ? 'Approved' : 'Rejected'}</h3>
         <p>Your attendance claim for <strong>${claim.course.courseName}</strong> on <strong>${claim.date.toDateString()}</strong> has been <strong>${label}</strong>.</p>
         ${resolution ? `<p>Note from supervisor: ${resolution}</p>` : ''}
         ${attendanceRecord ? '<p>Your attendance has been recorded as PRESENT.</p>' : ''}`
      ).catch(err => logger.error('Claim resolution email error:', err));

      const message = status === 'APPROVED'
        ? (createRecord ? 'Claim approved and attendance record created' : 'Claim approved')
        : 'Claim rejected';

      res.json({ message, claim: updatedClaim, attendanceRecord });
    } catch (error) {
      logger.error('Resolve claim error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
