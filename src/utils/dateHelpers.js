const moment = require('moment');

const formatDate = (date) => {
  return moment(date).format('YYYY-MM-DD');
};

const formatDateTime = (date) => {
  return moment(date).format('YYYY-MM-DD HH:mm:ss');
};

const getMonthDateRange = (month, year) => {
  const monthStr = month.toString().padStart(2, '0');
  const startDate = moment(`${year}-${monthStr}-01`).startOf('month').toDate();
  const endDate = moment(`${year}-${monthStr}-01`).endOf('month').toDate();
  return { startDate, endDate };
};

const calculateHours = (checkIn, checkOut) => {
  const duration = moment.duration(moment(checkOut).diff(moment(checkIn)));
  return duration.asHours();
};

module.exports = {
  formatDate,
  formatDateTime,
  getMonthDateRange,
  calculateHours
};