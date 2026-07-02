const express = require('express');
const { body, param } = require('express-validator');
const bcrypt = require('bcrypt');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor, isVerified } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// ─── Student ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/users/me:
 *   get:
 *     summary: Get the authenticated user's profile
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfile'
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
 *         description: User not found (deleted after token was issued)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authenticate, isVerified, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/users/me:
 *   put:
 *     summary: Update the authenticated user's password
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: NewPassword123
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Profile updated successfully
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: No valid fields provided
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: No valid fields provided for update
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: Validation error (password too short)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
router.put('/me',
  authenticate,
  isVerified,
  [
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    validate,
  ],
  async (req, res) => {
    try {
      const { password } = req.body;
      const updateData = {};

      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid fields provided for update' });
      }

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: updateData,
        select: { id: true, email: true, role: true, updatedAt: true },
      });
      res.json({ message: 'Profile updated successfully', user });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Supervisor ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List all registered users (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Array of user profiles
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/UserProfile'
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
 *             example:
 *               error: Forbidden: Supervisors only
 */
router.get('/', authenticate, isSupervisor, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        isVerified: true,
        createdAt: true,
      },
    });
    res.json(users);
  } catch (error) {
    logger.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete a user by ID (Supervisor only)
 *     description: Supervisors cannot delete themselves or other supervisors.
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the user to delete
 *         example: 64f1a2b3c4d5e6f7a8b9c0d1
 *     responses:
 *       200:
 *         description: User deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User deleted successfully
 *       400:
 *         description: Cannot delete own account / invalid ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               selfDelete:
 *                 value:
 *                   error: Cannot delete your own account
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
 *         description: Supervisor role required, or target is also a supervisor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               notSupervisor:
 *                 value:
 *                   error: Forbidden: Supervisors only
 *               targetSupervisor:
 *                 value:
 *                   error: Supervisors cannot delete other supervisors
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: User not found
 */
router.delete('/:id',
  authenticate,
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid user ID format'),
    validate,
  ],
  async (req, res) => {
    try {
      const { id } = req.params;

      if (id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) return res.status(404).json({ error: 'User not found' });
      if (targetUser.role === 'SUPERVISOR') {
        return res.status(403).json({ error: 'Supervisors cannot delete other supervisors' });
      }

      await prisma.user.delete({ where: { id } });
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
