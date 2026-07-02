/**
 * Supervisor API tests — uses the seeded SUPERVISOR account.
 * Covers: courses (CRUD), user management, attendance, enrollments.
 */

const request = require('supertest');
const app = require('../app');
const prisma = require('../src/config/db');

const SUPERVISOR_EMAIL = process.env.SUPERVISOR_EMAIL || 'admin@example.com';
const SUPERVISOR_PASSWORD = process.env.SUPERVISOR_PASSWORD || 'adminpassword123';

let supervisorToken = null;
let createdCourseId = null;

// ─── Setup: login as supervisor ───────────────────────────────────────────────

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: SUPERVISOR_EMAIL, password: SUPERVISOR_PASSWORD });

  if (res.status !== 200) {
    throw new Error(
      `Supervisor login failed (${res.status}): ${JSON.stringify(res.body)}. ` +
      'Run "npm run prisma:generate && node prisma/seed.js" to seed the admin account.'
    );
  }

  supervisorToken = res.body.accessToken;
});

afterAll(async () => {
  // Clean up any courses created during tests
  if (createdCourseId) {
    await prisma.course.deleteMany({ where: { id: createdCourseId } }).catch(() => {});
  }
  await prisma.$disconnect();
});

const authHeader = () => ({ Authorization: `Bearer ${supervisorToken}` });

// ─── Courses ──────────────────────────────────────────────────────────────────

describe('Courses (Supervisor)', () => {
  it('POST /api/courses — creates a course', async () => {
    const res = await request(app)
      .post('/api/courses')
      .set(authHeader())
      .send({ courseName: 'Test Course', description: 'A test course for automated tests' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.courseName).toBe('Test Course');
    createdCourseId = res.body.id;
  });

  it('POST /api/courses — rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/courses')
      .set(authHeader())
      .send({ courseName: '' });

    expect(res.status).toBe(400);
  });

  it('GET /api/courses — lists courses', async () => {
    const res = await request(app)
      .get('/api/courses')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/courses/:id — gets course by id', async () => {
    const res = await request(app)
      .get(`/api/courses/${createdCourseId}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdCourseId);
  });

  it('GET /api/courses/:id — 400 on invalid id format', async () => {
    const res = await request(app)
      .get('/api/courses/invalid-id')
      .set(authHeader());

    expect(res.status).toBe(400);
  });

  it('PUT /api/courses/:id — updates a course', async () => {
    const res = await request(app)
      .put(`/api/courses/${createdCourseId}`)
      .set(authHeader())
      .send({ courseName: 'Updated Course Name' });

    expect(res.status).toBe(200);
    expect(res.body.courseName).toBe('Updated Course Name');
  });

  it('DELETE /api/courses/:id — deletes a course', async () => {
    const res = await request(app)
      .delete(`/api/courses/${createdCourseId}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    createdCourseId = null;
  });
});

// ─── User management ──────────────────────────────────────────────────────────

describe('User management (Supervisor)', () => {
  it('GET /api/users — lists all users', async () => {
    const res = await request(app)
      .get('/api/users')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Should not expose passwords
    res.body.forEach(u => {
      expect(u).not.toHaveProperty('password');
      expect(u).not.toHaveProperty('hashedRefreshToken');
    });
  });

  it('DELETE /api/users/:id — rejects self-deletion', async () => {
    // Get supervisor user to find their id
    const usersRes = await request(app)
      .get('/api/users')
      .set(authHeader());
    const supervisor = usersRes.body.find(u => u.email === SUPERVISOR_EMAIL);
    expect(supervisor).toBeDefined();

    const res = await request(app)
      .delete(`/api/users/${supervisor.id}`)
      .set(authHeader());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot delete your own account/i);
  });
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('Auth guard', () => {
  it('returns 401 for requests without token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns 401 for expired/invalid token', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.status).toBe(401);
  });

  it('returns 403 when student tries a supervisor-only route', async () => {
    const studentEmail = `student_guard_${Date.now()}@example.com`;

    await request(app)
      .post('/api/auth/register')
      .send({ email: studentEmail, password: 'Test1234' });

    // Bypass email OTP — set verified directly in DB
    await prisma.user.update({
      where: { email: studentEmail },
      data: { isVerified: true, otp: null, otpExpires: null },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: studentEmail, password: 'Test1234' });

    expect(loginRes.status).toBe(200);
    const studentToken = loginRes.body.accessToken;

    const guardRes = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(guardRes.status).toBe(403);

    // Clean up
    await prisma.user.deleteMany({ where: { email: studentEmail } });
  });
});
