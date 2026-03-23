const express = require('express');
const { body, param } = require('express-validator');
const bcrypt = require('bcrypt');
const { validate } = require('../middleware/validate');
const prisma = require('../config/db');
const { authenticate, isSupervisor, isVerified } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * /api/users/me:
 *   get:
 *     summary: Get current authenticated user's profile
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile data
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
        updatedAt: true
      }
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
 *     summary: Update current user's profile
 *     tags: [Student Area]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.put('/me', 
  authenticate,
  isVerified,
  [
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    validate
  ],
  async (req, res) => {
    try {
      const { password } = req.body;
      let updateData = {};
      
      if (password) {
        updateData.password = await bcrypt.hash(password, 10);
      }
      
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'No valid fields provided for update' });
      }

      const user = await prisma.user.update({
        where: { id: req.user.id },
        data: updateData,
        select: {
          id: true,
          email: true,
          role: true,
          updatedAt: true
        }
      });
      res.json({ message: 'Profile updated successfully', user });
    } catch (error) {
      logger.error('Update profile error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users (Supervisor only)
 *     tags: [Supervisor Area]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all users
 */
router.get('/', authenticate, isSupervisor, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        isVerified: true,
        createdAt: true
      }
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
 *     summary: Delete a user (Supervisor only)
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
 *         description: User deleted successfully
 */
router.delete('/:id', 
  authenticate, 
  isSupervisor,
  [
    param('id').isMongoId().withMessage('Invalid user ID format'),
    validate
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      
      if (id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (targetUser.role === 'SUPERVISOR') {
        return res.status(403).json({ error: 'Supervisors cannot delete other supervisors' });
      }

      await prisma.user.delete({ where: { id } });
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      logger.error('Delete user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
