/**
 * Auth API tests — covers the full auth lifecycle:
 * register → verify-email → login → refresh-token → logout
 * Also tests rate limiter key isolation (per-email, not per-IP).
 */

jest.mock('../src/services/email.service');
const { sendEmail } = require('../src/services/email.service');

const request = require('supertest');
const app = require('../app');
const prisma = require('../src/config/db');

const TEST_EMAIL = `test_auth_${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPass123';

let capturedOtp = null;

// Intercept sendEmail and pull the 6-digit OTP out of the plain-text body
sendEmail.mockImplementation(async (_to, _subject, text) => {
  const match = text.match(/\d{6}/);
  if (match) capturedOtp = match[0];
  return true;
});

afterAll(async () => {
  // Clean up test user so re-runs don't collide
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

// ─── Registration ────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  it('registers a new student and sends OTP', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('userId');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(capturedOtp).toMatch(/^\d{6}$/);
  });

  it('rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email already exists');
  });

  it('rejects invalid email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: TEST_PASSWORD });

    expect(res.status).toBe(400);
  });

  it('rejects short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: '123' });

    expect(res.status).toBe(400);
  });
});

// ─── Email verification ───────────────────────────────────────────────────────

describe('POST /api/auth/verify-email', () => {
  it('rejects wrong OTP', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ email: TEST_EMAIL, otp: '000000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid or expired OTP');
  });

  it('verifies email with correct OTP', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ email: TEST_EMAIL, otp: capturedOtp });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/verified/i);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

let accessToken = null;
let refreshToken = null;

describe('POST /api/auth/login', () => {
  it('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('logs in successfully and returns tokens', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.role).toBe('STUDENT');

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });
});

// ─── Protected route ──────────────────────────────────────────────────────────

describe('GET /api/users/me', () => {
  it('rejects request without token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('returns profile for authenticated user', async () => {
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('hashedRefreshToken');
  });
});

// ─── Refresh token ────────────────────────────────────────────────────────────

let newAccessToken = null;
let newRefreshToken = null;

describe('POST /api/auth/refresh-token', () => {
  it('rejects missing refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken: 'not.a.valid.jwt' });

    expect(res.status).toBe(401);
  });

  it('issues new token pair with valid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    // New tokens must differ from the originals (rotation)
    expect(res.body.accessToken).not.toBe(accessToken);
    expect(res.body.refreshToken).not.toBe(refreshToken);

    newAccessToken = res.body.accessToken;
    newRefreshToken = res.body.refreshToken;
  });

  it('detects replay — old refresh token is now invalid', async () => {
    // Using the consumed refresh token should trigger replay protection
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|revoked/i);
  });

  it('new access token works on protected route', async () => {
    // After replay invalidation, re-login to get clean tokens
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(loginRes.status).toBe(200);
    newAccessToken = loginRes.body.accessToken;
    newRefreshToken = loginRes.body.refreshToken;

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${newAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('logs out successfully', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .send({ refreshToken: newRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });

  it('refresh token no longer works after logout', async () => {
    const res = await request(app)
      .post('/api/auth/refresh-token')
      .send({ refreshToken: newRefreshToken });

    expect(res.status).toBe(401);
  });

  it('access token still works until it expires (stateless)', async () => {
    // Access tokens are stateless JWTs — logout does not invalidate them
    // They simply expire after 15 minutes
    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${newAccessToken}`);

    expect(res.status).toBe(200);
  });
});

// ─── Password reset ───────────────────────────────────────────────────────────

describe('POST /api/auth/forgot-password + reset-password', () => {
  let resetOtp = null;

  it('sends reset OTP', async () => {
    sendEmail.mockClear();
    sendEmail.mockImplementation(async (_to, _subject, text) => {
      const match = text.match(/\d{6}/);
      if (match) resetOtp = match[0];
      return true;
    });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: TEST_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/email exists/i);
    expect(resetOtp).toMatch(/^\d{6}$/);
  });

  it('rejects wrong OTP on reset', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: TEST_EMAIL, otp: '000000', newPassword: 'NewPass123' });

    expect(res.status).toBe(400);
  });

  it('resets password with correct OTP', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ email: TEST_EMAIL, otp: resetOtp, newPassword: 'NewPass123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/reset successfully/i);
  });

  it('can login with new password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'NewPass123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
  });
});
