// src/services/tenantService.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_FILE = path.join(__dirname, '../../data/tenants.json');

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

function readAll() {
  ensureFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); }
  catch { return []; }
}

function writeAll(tenants) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(tenants, null, 2));
}

function normalizeDomain(domain) {
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();
}

function findByDomain(domain) {
  const normalized = normalizeDomain(domain);
  return readAll().find(t => normalizeDomain(t.domain) === normalized) || null;
}

function findById(id) {
  return readAll().find(t => t.id === id) || null;
}

function defaultBusinessHours() {
  return { start: 9, end: 18, days: [1,2,3,4,5] };
}

function create({ name, domain, webhookUrl, businessHours }) {
  const tenants = readAll();
  const normalized = normalizeDomain(domain);
  if (tenants.find(t => normalizeDomain(t.domain) === normalized)) {
    throw new Error('Já existe um tenant com esse domínio.');
  }
  const tenant = {
    id: uuidv4(),
    name: name.trim(),
    domain: normalized,
    webhookUrl: webhookUrl.trim(),
    businessHours: businessHours || defaultBusinessHours(),
    createdAt: new Date().toISOString(),
    active: true
  };
  tenants.push(tenant);
  writeAll(tenants);
  return tenant;
}

function update(id, { name, webhookUrl, active, businessHours }) {
  const tenants = readAll();
  const idx = tenants.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Tenant não encontrado.');
  if (name !== undefined) tenants[idx].name = name.trim();
  if (webhookUrl !== undefined) tenants[idx].webhookUrl = webhookUrl.trim();
  if (active !== undefined) tenants[idx].active = active;
  if (businessHours !== undefined) tenants[idx].businessHours = businessHours;
  tenants[idx].updatedAt = new Date().toISOString();
  writeAll(tenants);
  return tenants[idx];
}

function remove(id) {
  const tenants = readAll();
  const idx = tenants.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('Tenant não encontrado.');
  tenants.splice(idx, 1);
  writeAll(tenants);
}

module.exports = { readAll, findByDomain, findById, create, update, remove, normalizeDomain, defaultBusinessHours };
