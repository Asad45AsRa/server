const express       = require('express');
const router        = express.Router();
const { protect }   = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole }  = require('../config/constants');
const ctrl          = require('../controllers/hrController');

// All routes: must be logged in + HR role
router.use(protect);
router.use(checkRole(UserRole.HR));

// Employees
router.post('/employees',            ctrl.createEmployee);
router.get ('/employees',            ctrl.getAllEmployees);
router.put ('/employees/:id',        ctrl.updateEmployee);

// Attendance
router.post('/attendance',           ctrl.markAttendance);
router.post('/attendance/bulk',      ctrl.bulkMarkAttendance);
router.get ('/attendance',           ctrl.getAttendance);
router.get ('/attendance/summary',   ctrl.getAttendanceSummary);

// Salary
router.post('/salary/calculate',     ctrl.calculateMonthlySalary);
router.post('/salary',               ctrl.createSalary);
router.get ('/salary',               ctrl.getSalaries);
router.put ('/salary/:id/pay',       ctrl.paySalary);

module.exports = router;