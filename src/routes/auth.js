const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const prisma = require('../config/db');
const { validate } = require('../middleware/validate');
const { sendEmail } = require('../services/email.service');
const logger = require('../utils/logger');

const router = express.Router();

// Per-email rate limiter — 5 attempts per 15 min window per unique email address.
// Falls back to IP for requests without an email in the body.
// Skipped in test environment so the test suite can exercise all auth flows freely.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const email = req.body?.email;
    return email ? `email:${email.toLowerCase()}` : ipKeyGenerator(req);
  },
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const hashOtp   = (otp)   => crypto.createHash('sha256').update(otp).digest('hex');

// ─── Tags ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Public authentication endpoints (no token required)
 */

// ─── Register ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new student account
 *     description: Creates an unverified student account and sends a 6-digit OTP to the provided email. The OTP expires in 5 minutes. Call /verify-email to activate the account.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Account created — OTP sent to email
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: User registered. Please check your email for the verification code.
 *                 userId:
 *                   type: string
 *                   example: 64f1a2b3c4d5e6f7a8b9c0d1
 *       400:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Email already exists
 *       422:
 *         description: Validation error (invalid email or short password)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       429:
 *         description: Too many requests for this email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/register',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    validate,
  ],
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return res.status(400).json({ error: 'Email already exists' });

      const hashedPassword = await bcrypt.hash(password, 10);
      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          role: 'STUDENT',
          otp: hashOtp(otp),
          otpExpires,
          isVerified: false,
        },
      });

      await sendEmail(
        email,
        'Verify your SMS Express Account',
        `Your verification code is: ${otp}`,
        `<h2>Welcome to SMS Express</h2><p>Your verification code is: <strong>${otp}</strong></p><p>This code expires in 5 minutes.</p>`
      );

      res.status(201).json({
        message: 'User registered. Please check your email for the verification code.',
        userId: user.id,
      });
    } catch (error) {
      logger.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Verify email ─────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verify email address using the OTP sent at registration
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: student@example.com
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: "482910"
 *     responses:
 *       200:
 *         description: Email verified — account is now active
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Email verified successfully. You can now log in.
 *       400:
 *         description: OTP is wrong or has expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid or expired OTP
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       429:
 *         description: Too many requests for this email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/verify-email',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    validate,
  ],
  async (req, res) => {
    try {
      const { email, otp } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || new Date() > user.otpExpires) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const providedHash = hashOtp(otp);
      if (
        user.otp.length !== providedHash.length ||
        !crypto.timingSafeEqual(Buffer.from(user.otp), Buffer.from(providedHash))
      ) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      await prisma.user.update({
        where: { email },
        data: { isVerified: true, otp: null, otpExpires: null },
      });

      res.json({ message: 'Email verified successfully. You can now log in.' });
    } catch (error) {
      logger.error('Email verification error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Resend verification OTP ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Resend the email verification OTP
 *     description: You can only request a new OTP once the previous one expires (5 minutes).
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: student@example.com
 *     responses:
 *       200:
 *         description: New OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: A new verification code has been sent to your email.
 *       400:
 *         description: Account already verified, or previous OTP has not expired yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               alreadyVerified:
 *                 value:
 *                   error: User is already verified
 *               otpActive:
 *                 value:
 *                   error: Please wait for your previous OTP to expire (5 minutes) before requesting a new one.
 *       404:
 *         description: Email not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: User not found
 *       429:
 *         description: Too many requests for this email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/resend-verification',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    validate,
  ],
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.isVerified) return res.status(400).json({ error: 'User is already verified' });

      if (user.otpExpires && new Date() < user.otpExpires) {
        return res.status(400).json({
          error: 'Please wait for your previous OTP to expire (5 minutes) before requesting a new one.',
        });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.user.update({
        where: { email },
        data: { otp: hashOtp(otp), otpExpires },
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
  }
);

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in and receive an access + refresh token pair
 *     description: |
 *       Returns a short-lived access token (15 min) and a long-lived refresh token (7 days).
 *       Use the access token as `Authorization: Bearer <token>` on protected routes.
 *       Use the refresh token with POST /api/auth/refresh-token to get new tokens before
 *       the access token expires. Supervisors bypass the email-verification requirement.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid email or password
 *       403:
 *         description: Email not verified yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Please verify your email before logging in.
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       429:
 *         description: Too many login attempts for this email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
    validate,
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

      const accessSecret  = process.env.JWT_ACCESS_SECRET;
      const refreshSecret = process.env.JWT_REFRESH_SECRET;

      const accessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, isVerified: user.isVerified, jti: crypto.randomBytes(16).toString('hex') },
        accessSecret,
        { expiresIn: '15m' }
      );

      const refreshToken = jwt.sign(
        { id: user.id, jti: crypto.randomBytes(16).toString('hex') },
        refreshSecret,
        { expiresIn: '7d' }
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { hashedRefreshToken: hashToken(refreshToken) },
      });

      res.json({ message: 'Login successful', accessToken, refreshToken, role: user.role });
    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Refresh token ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     summary: Exchange a refresh token for a new access + refresh token pair
 *     description: |
 *       Implements refresh-token rotation — the submitted refresh token is invalidated
 *       and a brand-new pair is returned. Reusing an already-consumed refresh token
 *       (replay attack) immediately revokes ALL tokens for that user.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: New token pair issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPair'
 *       400:
 *         description: Refresh token missing from request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       401:
 *         description: Token is invalid, expired, or has already been used (replay)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid or expired refresh token
 */
router.post('/refresh-token',
  [
    body('refreshToken').trim().notEmpty().withMessage('Refresh token is required'),
    validate,
  ],
  async (req, res) => {
    try {
      const { refreshToken } = req.body;
      const refreshSecret = process.env.JWT_REFRESH_SECRET;

      const decoded = jwt.verify(refreshToken, refreshSecret);

      const user = await prisma.user.findUnique({ where: { id: decoded.id } });
      if (!user) return res.status(401).json({ error: 'Invalid or revoked refresh token' });

      if (user.hashedRefreshToken !== hashToken(refreshToken)) {
        logger.warn(`Token replay detected for user ${user.id}`);
        await prisma.user.update({
          where: { id: user.id },
          data: { hashedRefreshToken: null },
        });
        return res.status(401).json({ error: 'Invalid or revoked refresh token' });
      }

      const accessSecret = process.env.JWT_ACCESS_SECRET;

      const newAccessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, isVerified: user.isVerified, jti: crypto.randomBytes(16).toString('hex') },
        accessSecret,
        { expiresIn: '15m' }
      );

      const newRefreshToken = jwt.sign(
        { id: user.id, jti: crypto.randomBytes(16).toString('hex') },
        refreshSecret,
        { expiresIn: '7d' }
      );

      await prisma.user.update({
        where: { id: user.id },
        data: { hashedRefreshToken: hashToken(newRefreshToken) },
      });

      res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    } catch (error) {
      logger.error('Refresh token error:', error);
      res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
  }
);

// ─── Logout ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Invalidate the user's refresh token (logout)
 *     description: |
 *       Revokes the stored refresh token so it cannot be used to obtain new access tokens.
 *       Access tokens are stateless JWTs and remain valid until they expire (15 min).
 *       Always returns 200 — even if the token is already expired or invalid.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *     responses:
 *       200:
 *         description: Logged out (token revoked)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Logged out successfully
 *       400:
 *         description: Refresh token missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 */
router.post('/logout',
  [
    body('refreshToken').trim().notEmpty().withMessage('Refresh token is required'),
    validate,
  ],
  async (req, res) => {
    try {
      const { refreshToken } = req.body;
      const refreshSecret = process.env.JWT_REFRESH_SECRET;
      const decoded = jwt.verify(refreshToken, refreshSecret);

      await prisma.user.update({
        where: { id: decoded.id },
        data: { hashedRefreshToken: null },
      });

      res.json({ message: 'Logged out successfully' });
    } catch (_error) {
      // Token already invalid → user is effectively logged out
      res.json({ message: 'Logged out successfully' });
    }
  }
);

// ─── Forgot password ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request a password-reset OTP
 *     description: |
 *       Sends a 6-digit OTP to the email if it belongs to a registered account.
 *       The response is identical whether or not the email exists, to prevent
 *       user enumeration. OTP expires in 5 minutes.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: student@example.com
 *     responses:
 *       200:
 *         description: OTP sent (or silently skipped if email not found)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: If this email exists, you will receive a code.
 *       400:
 *         description: Previous OTP is still active — wait for it to expire
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Please wait for your previous OTP to expire (5 minutes) before requesting a new one.
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       429:
 *         description: Too many requests for this email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/forgot-password',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    validate,
  ],
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user) {
        await new Promise(resolve => setTimeout(resolve, 200));
        return res.json({ message: 'If this email exists, you will receive a code.' });
      }

      if (user.otpExpires && new Date() < user.otpExpires) {
        return res.status(400).json({
          error: 'Please wait for your previous OTP to expire (5 minutes) before requesting a new one.',
        });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

      await prisma.user.update({
        where: { email },
        data: { otp: hashOtp(otp), otpExpires },
      });

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
  }
);

// ─── Reset password ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password using the OTP from forgot-password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, newPassword]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: student@example.com
 *               otp:
 *                 type: string
 *                 minLength: 6
 *                 maxLength: 6
 *                 example: "391047"
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 example: NewSecurePass456
 *     responses:
 *       200:
 *         description: Password reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Password reset successfully
 *       400:
 *         description: OTP is wrong or has expired
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid or expired OTP
 *       422:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ValidationError'
 *       429:
 *         description: Too many requests for this email
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/reset-password',
  authLimiter,
  [
    body('email').trim().isEmail().withMessage('Please provide a valid email'),
    body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    validate,
  ],
  async (req, res) => {
    try {
      const { email, otp, newPassword } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || new Date() > user.otpExpires) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const providedHash = hashOtp(otp);
      if (
        user.otp.length !== providedHash.length ||
        !crypto.timingSafeEqual(Buffer.from(user.otp), Buffer.from(providedHash))
      ) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { email },
        data: { password: hashedPassword, otp: null, otpExpires: null },
      });

      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      logger.error('Reset password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
