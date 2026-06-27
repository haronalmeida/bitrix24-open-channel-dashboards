// src/routes/settings.js
const express = require('express');
const router = express.Router();
const tenantService = require('../services/tenantService');
const bitrixService = require('../services/bitrixService');

// GET /api/settings?domain=xxx
router.get('/settings', (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Domain obrigatório.' });
    const tenant = tenantService.findByDomain(domain);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    res.json({ success: true, businessHours: tenant.businessHours || { start: 9, end: 18, days: [1,2,3,4,5] } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings?domain=xxx
router.post('/settings', express.json(), (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Domain obrigatório.' });
    const tenant = tenantService.findByDomain(domain);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });

    const { start, end, days } = req.body;
    if (start === undefined || end === undefined || !days) {
      return res.status(400).json({ error: 'start, end e days são obrigatórios.' });
    }
    if (Number(start) >= Number(end)) {
      return res.status(400).json({ error: 'Horário de início deve ser menor que o fim.' });
    }
    if (!Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ error: 'Selecione ao menos um dia.' });
    }

    const businessHours = { start: Number(start), end: Number(end), days: days.map(Number) };
    tenantService.update(tenant.id, { businessHours });

    // Limpa cache para recalcular com novo horário
    bitrixService.clearCache(tenant.webhookUrl);

    res.json({ success: true, businessHours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
