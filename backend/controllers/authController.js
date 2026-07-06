const jwt = require('jsonwebtoken');

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const normalizedUser = username.trim().toLowerCase();

    // India Silk House administrator credentials
    const isValidUser = (normalizedUser === 'indiasilk' || normalizedUser === 'silkhouse' || normalizedUser === 'admin');
    const isValidPass = (password === 'silkhouse123' || password === 'silkhouse' || password === 'admin123' || password === 'admin');

    if (isValidUser && isValidPass) {
      const user = {
        Id: 1,
        Username: 'indiasilk',
        FullName: 'India Silk House Admin',
        Role: 'Admin',
      };

      const token = jwt.sign(
        { id: user.Id, username: user.Username, fullName: user.FullName, role: user.Role },
        process.env.JWT_SECRET || 'inv_secret_key_123',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      return res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user.Id,
          username: user.Username,
          fullName: user.FullName,
          role: user.Role,
        },
      });
    }

    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    return res.json({
      success: true,
      user: req.user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = { login, getMe };
