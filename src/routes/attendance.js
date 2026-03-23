const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Supervisor Area
 *   description: Administrative endpoints for supervisors
 */

/**
 * @swagger
 * /api/attendance/assess:
 *   post:
 *     summary: Mark student attendance (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               studentId:
 *                 type: string
 *               courseId:
 *                 type: string
 *               status:
 *                 type: boolean
 *                 description: true for present, false for absent
 *     responses:
 *       201:
 *         description: Attendance marked
 */
router.post('/assess', 
  authenticate, 
  isSupervisor,
  [
    body('studentId').isMongoId().withMessage('Invalid student ID format'),
    body('courseId').isMongoId().withMessage('Invalid course ID format'),
    body('status').isBoolean().withMessage('Status must be a boolean (true/false)'),
    validate
  ],
  async (req, res) => {
    try {
      const { studentId, courseId, status } = req.body;

      const attendance = await prisma.attendance.create({
        data: {
          userId: studentId,
          courseId: courseId,
          supervisorId: req.user.id,
          status: status
        }
      });

      res.status(201).json({ message: 'Attendance marked successfully', attendance });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/attendance/my-attendance:
 *   get:
 *     summary: View logged in student's attendance
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of attendance records
 */
router.get('/my-attendance', authenticate, async (req, res) => {
  try {
    const attendances = await prisma.attendance.findMany({
      where: { userId: req.user.id },
      include: {
        course: { select: { courseName: true } },
        supervisor: { select: { email: true } }
      },
      orderBy: { date: 'desc' }
    });

    res.json({ attendances });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/my-attendance/{courseId}:
 *   get:
 *     summary: View logged in student's attendance for a specific course
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
 *         description: List of attendance records for the specific course
 */
router.get('/my-attendance/:courseId', 
  authenticate,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const attendances = await prisma.attendance.findMany({
        where: { 
          userId: req.user.id,
          courseId: courseId
        },
        include: {
          course: { select: { courseName: true } },
          supervisor: { select: { email: true } }
        },
        orderBy: { date: 'desc' }
      });

      res.json({ attendances });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/attendance/course/{courseId}:
 *   get:
 *     summary: View all attendance for a specific course (Supervisor only)
 *     tags: [Supervisor Area]
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
 *         description: List of attendance records for the course
 */
router.get('/course/:courseId', 
  authenticate, 
  isSupervisor,
  [
    param('courseId').isMongoId().withMessage('Invalid course ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const attendances = await prisma.attendance.findMany({
        where: { courseId },
        include: {
          student: { select: { email: true } }
        },
        orderBy: { date: 'desc' }
      });
      res.json({ attendances });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/attendance/{id}:
 *   put:
 *     summary: Update an attendance record (Supervisor only)
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
 *             type: object
 *             properties:
 *               status:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Attendance updated
 */
router.put('/:id', 
  authenticate, 
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid attendance ID format'),
    body('status').isBoolean().withMessage('Status must be a boolean (true/false)'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const attendance = await prisma.attendance.update({
        where: { id },
        data: { status }
      });
      res.json(attendance);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/attendance/{id}:
 *   delete:
 *     summary: Delete an attendance record (Supervisor only)
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
 *         description: Attendance deleted
 */
router.delete('/:id', 
  authenticate, 
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid attendance ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      await prisma.attendance.delete({ where: { id } });
      res.json({ message: 'Attendance deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

module.exports = router;