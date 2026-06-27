// src/server.js
require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const apiRoutes      = require('./routes/api');
const adminRoutes    = require('./routes/admin');
const dashboardRoutes = require('./routes/dashboard');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  next();
});

app.use(express.static(path.join(__dirname, '../public')));

app.use('/api', apiRoutes);
app.use('/api', settingsRoutes);
app.use('/admin', adminRoutes);
app.use('/', dashboardRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.listen(PORT, () => {
  console.log(`\n⚡ Bitrix24 Dashboard rodando em http://localhost:${PORT}`);
  console.log(`📊 Dashboard:  http://localhost:${PORT}/`);
  console.log(`🔧 Admin:      http://localhost:${PORT}/admin`);
  console.log(`❤️  Health:     http://localhost:${PORT}/health\n`);
});
