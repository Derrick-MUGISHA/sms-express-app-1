const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const prisma = require('../config/db');
const { validate } = require('../middleware/validate');
const { sendEmail } = require('../services/email.service');
const logger = require('../utils/logger');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper to hash refresh tokens
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
// Helper to hash OTPs
const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

/**
 * @swagger
 * tags:
 *   name: Shared / Public
 *   description: Public authentication endpoints
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new student
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully. OTP sent via email (expires in 5 minutes).
 */
router.post('/register', 
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    validate
  ],
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(400).json({ error: 'Email already exists' });

      const hashedPassword = await bcrypt.hash(password, 10);
      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
      
      const user = await prisma.user.create({
        data: { 
          email, 
          password: hashedPassword,
          role: 'STUDENT',
          otp: hashOtp(otp),
          otpExpires,
          isVerified: false
        }
      });

      // Send OTP via SMTP
      await sendEmail(
        email, 
        'Verify your SMS Express Account', 
        `Your verification code is: ${otp}`,
        `<h2>Welcome to SMS Express</h2><p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 5 minutes.</p>`
      );

      res.status(201).json({ message: 'User registered. Please check your email for the verification code.', userId: user.id });
    } catch (error) {
      logger.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email using OTP
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/verify-email', 
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    validate
  ],
  async (req, res) => {
    try {
      const { email, otp } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || new Date() > user.otpExpires) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const providedHash = hashOtp(otp);
      if (user.otp.length !== providedHash.length || !crypto.timingSafeEqual(Buffer.from(user.otp), Buffer.from(providedHash))) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      await prisma.user.update({
        where: { email },
        data: { isVerified: true, otp: null, otpExpires: null }
      });

      res.json({ message: 'Email verified successfully. You can now log in.' });
    } catch (error) {
      logger.error('Email verification error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Resend email verification OTP
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP resent (expires in 5 minutes)
 *       400:
 *         description: Please wait for your previous OTP to expire (5 minutes) before requesting a new one
 */
router.post('/resend-verification', 
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    validate
  ],
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.isVerified) return res.status(400).json({ error: 'User is already verified' });

      if (user.otpExpires && new Date() < user.otpExpires) {
        return res.status(400).json({ error: 'Please wait for your previous OTP to expire (5 minutes) before requesting a new one.' });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

      await prisma.user.update({
        where: { email },
        data: { otp: hashOtp(otp), otpExpires }
      });

      await sendEmail(
        email, 
        'Verify your SMS Express Account', 
        `Your verification code is: ${otp}`,
        `<h2>Welcome to SMS Express</h2><p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 5 minutes.</p>`
      );

      res.json({ message: 'A new verification code has been sent to your email.' });
    } catch (error) {
      logger.error('Resend verification error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user and receive tokens
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful login
 */
router.post('/login', 
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || !(await bcrypt.compare(password, user.password))) {
        logger.warn(`Failed login attempt for email: ${email}`);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!user.isVerified && user.role !== 'SUPERVISOR') {
        return res.status(403).json({ error: 'Please verify your email before logging in.' });
      }

      const accessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;

      const accessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, isVerified: user.isVerified },
        accessSecret,
        { expiresIn: '15m' }
      );

      const refreshToken = jwt.sign(
        { id: user.id },
        refreshSecret,
        { expiresIn: '7d' }
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { hashedRefreshToken: hashToken(refreshToken) }
      });

      res.json({ message: 'Login successful', accessToken, refreshToken, role: user.role });
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Get a new access token using a refresh token
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New tokens generated
 */
router.post('/refresh-token', 
  [
    body('refreshToken').trim().notEmpty().withMessage('Refresh token is required'),
    validate
  ],
  async (req, res) => {
    try {
      const { refreshToken } = req.body;
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      
      const decoded = jwt.verify(refreshToken, refreshSecret);
      
      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (!user) return res.status(401).json({ error: 'Invalid or revoked refresh token' });

      // Replay attack check
      if (user.hashedRefreshToken !== hashToken(refreshToken)) {
        logger.warn(`Token replay detected for user ${user.id}`);
        // Invalidate all tokens for this user
        await prisma.user.update({
          where: { id: user.id },
          data: { hashedRefreshToken: null }
        });
        return res.status(401).json({ error: 'Invalid or revoked refresh token' });
      }

      // Issue new token pair
      const accessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
      
      const newAccessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, isVerified: user.isVerified },
        accessSecret,
        { expiresIn: '15m' }
      );

      const newRefreshToken = jwt.sign(
        { id: user.id },
        refreshSecret,
        { expiresIn: '7d' }
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { hashedRefreshToken: hashToken(newRefreshToken) }
      });

      res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    } catch (error) {
      logger.error('Refresh token error:', error);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Invalidate a signed-in user's refresh token
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout',
  [
    body('refreshToken').trim().notEmpty().withMessage('Refresh token is required'),
    validate
  ],
  async (req, res) => {
    try {
      const { refreshToken } = req.body;
      const refreshSecret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
      const decoded = jwt.verify(refreshToken, refreshSecret);
      
      await prisma.user.update({
        where: { id: decoded.id },
        data: { hashedRefreshToken: null }
      });

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
       // If token is invalid or expired, just return success since they are already effectively logged out
      res.json({ message: 'Logged out successfully' });
    }
});

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request OTP for password reset
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP generated (expires in 5 minutes)
 *       400:
 *         description: Please wait for your previous OTP to expire (5 minutes) before requesting a new one
 */
router.post('/forgot-password', 
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    validate
  ],
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      
      if (!user) {
        // Obfuscate whether user exists
        return res.json({ message: 'If this email exists, you will receive a code.' });
      }

      if (user.otpExpires && new Date() < user.otpExpires) {
        return res.status(400).json({ error: 'Please wait for your previous OTP to expire (5 minutes) before requesting a new one.' });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

      await prisma.user.update({
        where: { email },
        data: { otp: hashOtp(otp), otpExpires }
      });

      // Send via SMTP
      await sendEmail(
        email, 
        'Reset Password - SMS Express', 
        `Your password reset code is: ${otp}`,
        `<h2>Password Reset Request</h2><p>Your password reset code is: <strong>${otp}</strong></p><p>This code expires in 5 minutes.</p>`
      );

      res.json({ message: 'If this email exists, you will receive a code.' });
    } catch (error) {
      logger.error('Forgot password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password using OTP
 *     tags: [Shared / Public]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               otp:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/reset-password', 
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    validate
  ],
  async (req, res) => {
    try {
      const { email, otp, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || new Date() > user.otpExpires) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const providedHash = hashOtp(otp);
      if (user.otp.length !== providedHash.length || !crypto.timingSafeEqual(Buffer.from(user.otp), Buffer.from(providedHash))) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { email },
        data: { password: hashedPassword, otp: null, otpExpires: null }
      });

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      logger.error('Reset password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;