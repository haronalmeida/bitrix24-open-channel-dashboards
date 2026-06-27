// src/routes/admin.js
const express = require('express');
const router = express.Router();
const tenantService = require('../services/tenantService');
const adminAuth = require('../middleware/adminAuth');

router.get('/login', (req, res) => res.send(loginPage()));
router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  const secret = process.env.ADMIN_SECRET || 'admin123';
  if (req.body.password === secret) {
    res.cookie('admin_token', secret, { httpOnly: true, maxAge: 86400000 });
    return res.redirect('/admin');
  }
  res.send(loginPage('Senha incorreta.'));
});
router.get('/logout', (req, res) => { res.clearCookie('admin_token'); res.redirect('/admin/login'); });

router.use(adminAuth);

router.get('/', (req, res) => {
  const tenants = tenantService.readAll();
  res.send(adminPage(tenants));
});

router.post('/tenants', express.urlencoded({ extended: true }), (req, res) => {
  try {
    const { name, domain, webhookUrl, bh_start, bh_end, bh_days } = req.body;
    if (!name || !domain || !webhookUrl) throw new Error('Nome, domínio e webhook são obrigatórios.');
    const days = Array.isArray(bh_days) ? bh_days.map(Number) : (bh_days ? [Number(bh_days)] : [1,2,3,4,5]);
    const businessHours = { start: Number(bh_start) || 9, end: Number(bh_end) || 18, days };
    tenantService.create({ name, domain, webhookUrl, businessHours });
    res.redirect('/admin?success=Conta+cadastrada+com+sucesso.');
  } catch (err) {
    res.send(adminPage(tenantService.readAll(), err.message));
  }
});

router.get('/tenants/:id/edit', (req, res) => {
  const tenant = tenantService.findById(req.params.id);
  if (!tenant) return res.redirect('/admin?error=Tenant+não+encontrado.');
  res.send(editPage(tenant));
});

router.post('/tenants/:id/edit', express.urlencoded({ extended: true }), (req, res) => {
  try {
    const { name, webhookUrl, bh_start, bh_end, bh_days } = req.body;
    const days = Array.isArray(bh_days) ? bh_days.map(Number) : (bh_days ? [Number(bh_days)] : [1,2,3,4,5]);
    const businessHours = { start: Number(bh_start) || 9, end: Number(bh_end) || 18, days };
    tenantService.update(req.params.id, { name, webhookUrl, businessHours });
    res.redirect('/admin?success=Conta+atualizada+com+sucesso.');
  } catch (err) {
    res.redirect('/admin?error=' + encodeURIComponent(err.message));
  }
});

router.post('/tenants/:id/toggle', (req, res) => {
  try {
    const tenant = tenantService.findById(req.params.id);
    if (!tenant) throw new Error('Tenant não encontrado.');
    tenantService.update(req.params.id, { active: !tenant.active });
    res.redirect('/admin');
  } catch (err) {
    res.redirect('/admin?error=' + encodeURIComponent(err.message));
  }
});

router.post('/tenants/:id/delete', (req, res) => {
  try {
    tenantService.remove(req.params.id);
    res.redirect('/admin?success=Conta+removida.');
  } catch (err) {
    res.redirect('/admin?error=' + encodeURIComponent(err.message));
  }
});

// ─── HTML ─────────────────────────────────────────────────────────────────────
const STYLES = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #f1f5f9; min-height: 100vh; }
header { background: #1e293b; border-bottom: 1px solid #334155; padding: 16px 32px; display: flex; justify-content: space-between; align-items: center; }
header h1 { font-size: 18px; }
header a { color: #94a3b8; font-size: 13px; text-decoration: none; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
.section-title { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 14px; }
.card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-full { grid-column: 1 / -1; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
label { font-size: 12px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
input, select { padding: 9px 13px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 14px; outline: none; width: 100%; }
input:focus, select:focus { border-color: #6366f1; }
.days-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.day-check { display: flex; align-items: center; gap: 6px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.day-check input[type=checkbox] { width: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px 14px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #334155; }
td { padding: 12px 14px; border-bottom: 1px solid #1e293b; font-size: 13px; color: #94a3b8; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
.badge { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge-on { background: #14532d; color: #4ade80; }
.badge-off { background: #450a0a; color: #f87171; }
.btn { padding: 8px 16px; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
.btn-primary { background: #6366f1; color: #fff; }
.btn-primary:hover { background: #4f46e5; }
.btn-ghost { background: #334155; color: #cbd5e1; margin-right: 4px; }
.btn-ghost:hover { background: #475569; }
.btn-danger { background: #7f1d1d; color: #fca5a5; }
.btn-warning { background: #78350f; color: #fcd34d; margin-right: 4px; }
.alert { padding: 12px 16px; border-radius: 8px; font-size: 14px; margin-bottom: 20px; }
.alert-error { background: #7f1d1d; color: #fca5a5; }
.alert-success { background: #14532d; color: #4ade80; }
.bh-summary { font-size: 12px; color: #6366f1; margin-top: 4px; }
`;

function dayName(d) { return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d]; }
function formatBH(bh) {
  if (!bh) return '9h–18h, Seg–Sex';
  const days = (bh.days || [1,2,3,4,5]).map(dayName).join(', ');
  return `${bh.start}h–${bh.end}h | ${days}`;
}

function loginPage(error = '') {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Admin</title>
  <style>* { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; background: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 40px; width: 380px; }
  h1 { color: #f1f5f9; font-size: 22px; margin-bottom: 8px; }
  p { color: #94a3b8; font-size: 14px; margin-bottom: 28px; }
  label { display: block; color: #cbd5e1; font-size: 13px; margin-bottom: 6px; }
  input { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 15px; outline: none; box-sizing: border-box; }
  button { width: 100%; margin-top: 20px; padding: 11px; background: #6366f1; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 600; }
  .error { background: #7f1d1d; color: #fca5a5; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }</style>
  </head><body><div class="card"><div style="font-size:28px;margin-bottom:16px">⚡</div>
  <h1>Painel Admin</h1><p>Bitrix24 Dashboard Multi-Tenant</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/admin/login">
  <label>Senha de acesso</label>
  <input type="password" name="password" placeholder="••••••••" autofocus required>
  <button type="submit">Entrar</button></form></div></body></html>`;
}

function daysCheckboxes(selected = [1,2,3,4,5]) {
  return [0,1,2,3,4,5,6].map(d =>
    `<label class="day-check">
      <input type="checkbox" name="bh_days" value="${d}" ${selected.includes(d) ? 'checked' : ''}>
      ${dayName(d)}
    </label>`
  ).join('');
}

function adminPage(tenants, error = '') {
  const rows = tenants.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:32px">Nenhuma conta cadastrada.</td></tr>`
    : tenants.map(t => `<tr>
        <td><strong style="color:#f1f5f9">${t.name}</strong></td>
        <td style="font-size:12px">${t.domain}</td>
        <td><span class="bh-summary">${formatBH(t.businessHours)}</span></td>
        <td><span class="badge ${t.active ? 'badge-on' : 'badge-off'}">${t.active ? 'Ativo' : 'Inativo'}</span></td>
        <td style="white-space:nowrap">
          <a href="/admin/tenants/${t.id}/edit" class="btn btn-warning" style="text-decoration:none;display:inline-block;margin-right:4px">Editar</a>
          <form method="POST" action="/admin/tenants/${t.id}/toggle" style="display:inline">
            <button class="btn btn-ghost">${t.active ? 'Desativar' : 'Ativar'}</button>
          </form>
          <form method="POST" action="/admin/tenants/${t.id}/delete" style="display:inline" onsubmit="return confirm('Remover?')">
            <button class="btn btn-danger">Remover</button>
          </form>
        </td>
      </tr>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Admin</title>
  <style>${STYLES}</style></head><body>
  <header><h1>⚡ Bitrix24 Dashboard <span style="color:#6366f1;font-size:13px;font-weight:400">Admin</span></h1>
  <a href="/admin/logout">Sair</a></header>
  <main>
  ${error ? `<div class="alert alert-error">${error}</div>` : ''}
  <div id="msg"></div>

  <div class="section-title">Nova Conta Bitrix24</div>
  <div class="card">
    <form method="POST" action="/admin/tenants">
      <div class="form-grid">
        <div class="form-group">
          <label>Nome da empresa</label>
          <input type="text" name="name" placeholder="Ex: Empresa ABC" required>
        </div>
        <div class="form-group">
          <label>Domínio Bitrix24</label>
          <input type="text" name="domain" placeholder="empresa.bitrix24.com.br" required>
        </div>
        <div class="form-group form-full">
          <label>URL do Webhook Inbound</label>
          <input type="url" name="webhookUrl" placeholder="https://empresa.bitrix24.com.br/rest/1/token/" required>
        </div>
        <div class="form-group">
          <label>Horário comercial — Início (hora)</label>
          <input type="number" name="bh_start" value="9" min="0" max="23">
        </div>
        <div class="form-group">
          <label>Horário comercial — Fim (hora)</label>
          <input type="number" name="bh_end" value="18" min="1" max="24">
        </div>
        <div class="form-group form-full">
          <label>Dias de atendimento</label>
          <div class="days-grid">${daysCheckboxes([1,2,3,4,5])}</div>
        </div>
        <div class="form-full" style="text-align:right">
          <button type="submit" class="btn btn-primary">+ Adicionar conta</button>
        </div>
      </div>
    </form>
  </div>

  <div class="section-title">Contas Cadastradas (${tenants.length})</div>
  <div class="card" style="padding:0;overflow:hidden">
    <table>
      <thead><tr><th>Nome</th><th>Domínio</th><th>Horário Comercial</th><th>Status</th><th>Ações</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  </main>
  <script>
    const p = new URLSearchParams(location.search);
    if (p.get('success')) document.getElementById('msg').innerHTML = '<div class="alert alert-success">'+p.get('success')+'</div>';
    if (p.get('error')) document.getElementById('msg').innerHTML = '<div class="alert alert-error">'+p.get('error')+'</div>';
  </script>
  </body></html>`;
}

function editPage(tenant) {
  const bh = tenant.businessHours || { start: 9, end: 18, days: [1,2,3,4,5] };
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Editar Tenant</title>
  <style>${STYLES}</style></head><body>
  <header><h1>⚡ Editar Conta</h1><a href="/admin">Voltar</a></header>
  <main>
  <div class="section-title">Editando: ${tenant.name}</div>
  <div class="card">
    <form method="POST" action="/admin/tenants/${tenant.id}/edit">
      <div class="form-grid">
        <div class="form-group">
          <label>Nome da empresa</label>
          <input type="text" name="name" value="${tenant.name}" required>
        </div>
        <div class="form-group">
          <label>Domínio (não editável)</label>
          <input type="text" value="${tenant.domain}" disabled style="opacity:0.5">
        </div>
        <div class="form-group form-full">
          <label>URL do Webhook Inbound</label>
          <input type="url" name="webhookUrl" value="${tenant.webhookUrl}" required>
        </div>
        <div class="form-group">
          <label>Horário comercial — Início (hora)</label>
          <input type="number" name="bh_start" value="${bh.start}" min="0" max="23">
        </div>
        <div class="form-group">
          <label>Horário comercial — Fim (hora)</label>
          <input type="number" name="bh_end" value="${bh.end}" min="1" max="24">
        </div>
        <div class="form-group form-full">
          <label>Dias de atendimento</label>
          <div class="days-grid">${daysCheckboxes(bh.days)}</div>
        </div>
        <div class="form-full" style="text-align:right;display:flex;gap:10px;justify-content:flex-end">
          <a href="/admin" class="btn btn-ghost" style="text-decoration:none">Cancelar</a>
          <button type="submit" class="btn btn-primary">Salvar alterações</button>
        </div>
      </div>
    </form>
  </div>
  </main></body></html>`;
}

module.exports = router;
