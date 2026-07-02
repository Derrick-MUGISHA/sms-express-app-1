const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Student Management System API',
      version: '1.0.0',
      description:
        'REST API for the SMS application — authentication, course management, ' +
        'enrollment, attendance tracking, stories, and vehicle registration.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token obtained from POST /api/auth/login',
        },
      },
      schemas: {
        // ── Common ────────────────────────────────────────────────────────
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Error message describing what went wrong' },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Validation failed' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', example: 'email' },
                  message: { type: 'string', example: 'Please provide a valid email' },
                },
              },
            },
          },
        },
        // ── Auth ──────────────────────────────────────────────────────────
        RegisterRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'student@example.com' },
            password: { type: 'string', minLength: 6, example: 'SecurePass123' },
          },
        },
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'student@example.com' },
            password: { type: 'string', example: 'SecurePass123' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Login successful' },
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            role: { type: 'string', enum: ['STUDENT', 'SUPERVISOR', 'USER'], example: 'STUDENT' },
          },
        },
        TokenPair: {
          type: 'object',
          properties: {
            accessToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
            refreshToken: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
          },
        },
        // ── Users ─────────────────────────────────────────────────────────
        UserProfile: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            email: { type: 'string', format: 'email', example: 'student@example.com' },
            role: { type: 'string', enum: ['STUDENT', 'SUPERVISOR', 'USER'], example: 'STUDENT' },
            isVerified: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        // ── Courses ───────────────────────────────────────────────────────
        CourseInput: {
          type: 'object',
          required: ['courseName', 'description'],
          properties: {
            courseName: { type: 'string', maxLength: 100, example: 'Introduction to Programming' },
            description: { type: 'string', maxLength: 500, example: 'Fundamentals of programming using Python.' },
          },
        },
        CourseResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            courseName: { type: 'string', example: 'Introduction to Programming' },
            description: { type: 'string', example: 'Fundamentals of programming using Python.' },
            supervisorId: { type: 'string', nullable: true, example: '64f1a2b3c4d5e6f7a8b9c0d2' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        // ── Attendance ────────────────────────────────────────────────────
        AttendanceRecord: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            userId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
            courseId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d3' },
            supervisorId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d4' },
            status: { type: 'boolean', description: 'true = present, false = absent', example: true },
            date: { type: 'string', format: 'date-time' },
          },
        },
        BulkAttendanceInput: {
          type: 'object',
          required: ['courseId', 'records'],
          properties: {
            courseId: { type: 'string', description: 'MongoDB ObjectId of the course', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            records: {
              type: 'array',
              minItems: 1,
              description: 'One entry per student',
              items: {
                type: 'object',
                required: ['studentId', 'status'],
                properties: {
                  studentId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
                  status: { type: 'boolean', description: 'true = present, false = absent', example: true },
                },
              },
            },
          },
        },
        AttendanceStats: {
          type: 'object',
          properties: {
            total: { type: 'integer', example: 20 },
            present: { type: 'integer', example: 15 },
            absent: { type: 'integer', example: 5 },
            attendanceRate: { type: 'number', format: 'float', example: 75.0, description: 'Percentage present' },
          },
        },
        AttendanceClaim: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            userId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
            courseId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d3' },
            date: { type: 'string', format: 'date-time', description: 'Date the student claims they were present' },
            reason: { type: 'string', example: 'I was present but my attendance was not recorded' },
            status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'], example: 'PENDING' },
            resolvedBy: { type: 'string', nullable: true, example: '64f1a2b3c4d5e6f7a8b9c0d4' },
            resolution: { type: 'string', nullable: true, example: 'Verified with class photo — attendance updated' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        // ── Marks / Assignments ───────────────────────────────────────────────
        MarkInput: {
          type: 'object',
          required: ['studentId', 'courseId', 'title', 'score', 'maxScore'],
          properties: {
            studentId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            courseId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
            title: { type: 'string', maxLength: 200, example: 'Week 3 Assignment' },
            score: { type: 'number', format: 'float', minimum: 0, example: 85 },
            maxScore: { type: 'number', format: 'float', minimum: 1, example: 100 },
            type: { type: 'string', enum: ['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION'], example: 'ASSIGNMENT' },
            feedback: { type: 'string', maxLength: 1000, nullable: true, example: 'Great work on the recursion section.' },
          },
        },
        MarkResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            userId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d2' },
            courseId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d3' },
            supervisorId: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d4' },
            title: { type: 'string', example: 'Week 3 Assignment' },
            score: { type: 'number', example: 85 },
            maxScore: { type: 'number', example: 100 },
            type: { type: 'string', enum: ['ASSIGNMENT', 'QUIZ', 'EXAM', 'PROJECT', 'PARTICIPATION'], example: 'ASSIGNMENT' },
            feedback: { type: 'string', nullable: true, example: 'Great work on the recursion section.' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        // ── Stories ───────────────────────────────────────────────────────────
        StoryInput: {
          type: 'object',
          required: ['authorName', 'content'],
          properties: {
            authorName: { type: 'string', maxLength: 100, example: 'Alice Mugisha' },
            content: { type: 'string', maxLength: 5000, example: 'My journey learning to code...' },
          },
        },
        StoryResponse: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '64f1a2b3c4d5e6f7a8b9c0d1' },
            authorName: { type: 'string', example: 'Alice Mugisha' },
            content: { type: 'string', example: 'My journey learning to code...' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

const swaggerDocs = (app) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    swaggerOptions: { persistAuthorization: true },
  }));
  console.log('Swagger Docs available at http://localhost:3000/api-docs');
};

module.exports = swaggerDocs;
