// src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

router.post('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

module.exports = router;
