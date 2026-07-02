require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  console.error("CRITICAL ERROR: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be defined in the environment.");
  process.exit(1);
}



// Import Swagger
const swaggerDocs = require('./swagger');

const authRoutes = require('./src/routes/auth');
const courseRoutes = require('./src/routes/course');
const attendanceRoutes = require('./src/routes/attendance');
const enrollmentRoutes = require('./src/routes/enrollment');
const userRoutes = require('./src/routes/user');
const storyRoutes = require('./src/routes/story');
const vehicleServiceRoutes = require('./src/routes/vehicleService');

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

app.use(cors({
  origin: allowedOrigins,
  methods: '*',
  allowedHeaders: '*',
  exposedHeaders: '*',
  credentials: false
}));

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
}));

// Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minutes
  max: 10000, // Limit each IP to 100 requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

app.use(express.json({ limit: '10kb' }));

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/vehicle-service', vehicleServiceRoutes);

// Initialize Swagger
// if (process.env.NODE_ENV !== 'production') {
//   swaggerDocs(app);
// }

swaggerDocs(app);

// Handle JSON SyntaxErrors to return a friendly JSON message instead of HTML
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload. Please check your request body.' });
  }
  next(err);
});

const PORT = process.env.PORT;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});