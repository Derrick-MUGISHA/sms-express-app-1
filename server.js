require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Import Swagger
const swaggerDocs = require('./swagger');

const authRoutes = require('./src/routes/auth');
const courseRoutes = require('./src/routes/course');
const attendanceRoutes = require('./src/routes/attendance');
const enrollmentRoutes = require('./src/routes/enrollment');
const userRoutes = require('./src/routes/user');

const app = express();

app.use(express.json());

// Handle JSON SyntaxErrors to return a friendly JSON message instead of HTML
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload. Please check your request body (e.g., look for trailing commas, missing quotes).' });
  }
  next();
});

app.use(cors());

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/users', userRoutes);

// Initialize Swagger
swaggerDocs(app);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});