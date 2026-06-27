// src/routes/dashboard.js
const express = require('express');
const router = express.Router();
const path = require('path');

// Serve o HTML do dashboard (será aberto no iframe do Bitrix24)
router.get('/', (req, res) => {
});

// Bitrix24 faz POST ao abrir o app
router.post('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

module.exports = router;
