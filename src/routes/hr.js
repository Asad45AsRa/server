const express = require('express');
const router  = express.Router();
const { protect }    = require('../middlewares/auth');
const { checkRole }  = require('../middlewares/roleCheck');
const { UserRole }   = require('../config/constants');

const {
  createEmployee, getAllEmployees, updateEmployee,
  markAttendance, bulkMarkAttendance, getAttendance, getAttendanceSummary,
  calculateMonthlySalary, createSalary, getSalaries, paySalary,
  createJobPosting, getJobPostings, updateJobPosting,
  getApplications, updateApplicationStatus, scheduleInterview, hireApplicant,
} = require('../controllers/hrController');

// All HR routes require authentication + HR role
router.use(protect);
router.use(checkRole(UserRole.HR));

// ---- Employees ----
router.post  ('/employees',     createEmployee);
router.get   ('/employees',     getAllEmployees);
router.put   ('/employees/:id', updateEmployee);

// ---- Attendance ----
router.post  ('/attendance',         markAttendance);
router.post  ('/attendance/bulk',    bulkMarkAttendance);
router.get   ('/attendance',         getAttendance);
router.get   ('/attendance/summary', getAttendanceSummary);

// ---- Salary ----
router.post  ('/salary/calculate',  calculateMonthlySalary);
router.post  ('/salary',            createSalary);
router.get   ('/salary',            getSalaries);
router.put   ('/salary/:id/pay',    paySalary);

// ---- Job Postings ----
router.post  ('/jobs',      createJobPosting);
router.get   ('/jobs',      getJobPostings);
router.put   ('/jobs/:id',  updateJobPosting);

// ---- Applications ----
router.get   ('/applications',                    getApplications);
router.put   ('/applications/:id/status',         updateApplicationStatus);
router.put   ('/applications/:id/interview',      scheduleInterview);
router.put   ('/applications/:id/hire',           hireApplicant);

module.exports = router;