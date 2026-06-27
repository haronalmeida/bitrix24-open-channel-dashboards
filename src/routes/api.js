// src/routes/api.js
const express = require('express');
const router = express.Router();
const tenantService = require('../services/tenantService');
const metricsService = require('../services/metricsService');
const bitrixService = require('../services/bitrixService');
const { parseBH } = require('../services/businessHours');

// GET /api/metrics
router.get('/metrics', async (req, res) => {
  try {
    const { domain, dateFrom, dateTo } = req.query;
    // Aceita operatorId simples ou múltiplos: ?operatorId=1&operatorId=2
    const rawIds = req.query.operatorId;
    const operatorIds = rawIds
      ? (Array.isArray(rawIds) ? rawIds : [rawIds]).map(String).filter(Boolean)
      : [];
    if (!domain) return res.status(400).json({ error: 'Parâmetro "domain" é obrigatório.' });

    const tenant = tenantService.findByDomain(domain);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado para este domínio.' });
    if (!tenant.active) return res.status(403).json({ error: 'Tenant inativo.' });

    const bh = parseBH(tenant);

    const metrics = await metricsService.getMetrics(
      tenant.webhookUrl,
      { dateFrom: dateFrom || null, dateTo: dateTo || null, operatorIds },
      bh
    );

    res.json({ success: true, tenant: { id: tenant.id, name: tenant.name, businessHours: bh }, ...metrics });
  } catch (err) {
    console.error('[/api/metrics]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/operators
router.get('/operators', async (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Parâmetro "domain" é obrigatório.' });
    const tenant = tenantService.findByDomain(domain);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    const operators = await bitrixService.getOperators(tenant.webhookUrl);
    res.json({ success: true, operators });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Parâmetro "domain" é obrigatório.' });
    const tenant = tenantService.findByDomain(domain);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    bitrixService.clearCache(tenant.webhookUrl);
    res.json({ success: true, message: 'Cache limpo.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
