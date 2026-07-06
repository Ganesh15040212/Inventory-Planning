const express = require('express');
const router = express.Router();
const { saveHistory } = require('../controllers/historyController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.post('/', saveHistory);

module.exports = router;
