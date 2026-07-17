require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const historyRoutes = require('./routes/history');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow localhost AND any device on the local office network (192.168.x.x / 10.x.x.x)
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
    if (/^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return callback(null, true);
    if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return callback(null, true);
    if (/^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return callback(null, true);
    callback(null, true);
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── REQUEST LOGGER (DEV ONLY) ────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use((req, _res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/export', exportRoutes);

// ─── HEALTH CHECKS ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

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
        database: process.env.DB_DATABASE || process.env.DB_NAME || 'default',
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
        database: process.env.DB_DATABASE || process.env.DB_NAME || 'default',
        user: process.env.DB_USER || 'none',
        env: process.env.NODE_ENV || 'not set'
      },
      error: err.message,
      code: err.code
    });
  }
});

// ─── SERVE REACT FRONTEND (PRODUCTION) ───────────────────────────────────────
// Points to the compiled React build inside frontend/dist
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));

// React Router fallback: serves index.html for all non-API routes
// This ensures refreshing on /dashboard, /export, /sales-report works correctly
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, message: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
// '0.0.0.0' makes the server accessible from any device on the local network
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Inventory Planning App running!`);
  console.log(`   ➜ Local:   http://localhost:${PORT}`);
  console.log(`   ➜ Network: http://<your-local-ip>:${PORT}`);
  console.log(`   ➜ Health:  http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
