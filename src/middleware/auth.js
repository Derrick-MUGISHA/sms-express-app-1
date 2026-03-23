const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized: No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const isSupervisor = (req, res, next) => {
  if (req.user.role !== 'SUPERVISOR') {
    return res.status(403).json({ error: 'Forbidden: Supervisors only' });
  }
  next();
};

const isVerified = (req, res, next) => {
  if (req.user.role === 'SUPERVISOR' || req.user.isVerified) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: Please verify your email to access this resource.' });
};

module.exports = { authenticate, isSupervisor, isVerified };