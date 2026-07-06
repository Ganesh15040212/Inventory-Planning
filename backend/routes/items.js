const express = require('express');
const router = express.Router();
const { getItemDetails, recalculate, searchItems, getDashboardStats } = require('../controllers/itemController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/stats', getDashboardStats);
router.get('/search', searchItems);
router.get('/:itemCode', getItemDetails);
router.post('/calculate', recalculate);

module.exports = router;
