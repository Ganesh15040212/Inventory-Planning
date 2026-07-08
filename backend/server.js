require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const historyRoutes = require('./routes/history');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger (dev)
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/export', exportRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Database Diagnostic Health check
app.get('/api/health/db', async (_req, res) => {
  const { getPool } = require('./config/db');
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT @@version as version');
    res.json({
      status: 'connected',
      timestamp: new Date().toISOString(),
      config: {
        server: process.env.DB_SERVER || 'default (localhost)',
        database: process.env.DB_DATABASE || process.env.DB_NAME || 'default (RIINDIASILKSNEW)',
        user: process.env.DB_USER || 'none',
        env: process.env.NODE_ENV || 'not set'
      },
      version: result.recordset[0].version
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      message: 'Database connection failed',
      config: {
        server: process.env.DB_SERVER || 'default (localhost)',
        database: process.env.DB_DATABASE || process.env.DB_NAME || 'default (RIINDIASILKSNEW)',
        user: process.env.DB_USER || 'none',
        env: process.env.NODE_ENV || 'not set'
      },
      error: err.message,
      code: err.code
    });
  }
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Inventory Planning API running on http://localhost:${PORT}`);
  console.log(`📋 API Health: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
