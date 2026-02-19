const express = require('express');
const router  = express.Router();
const { submitPublicApplication, getPublicJobs } = require('../controllers/hrController');

// Public — no authentication required
// These endpoints are used by the external applicant portal / Apply page

router.get  ('/jobs',  getPublicJobs);           // GET /api/public/jobs
router.post ('/apply', submitPublicApplication); // POST /api/public/apply

module.exports = router;