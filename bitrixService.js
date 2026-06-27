// src/services/bitrixService.js
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL || '60') });

// ─── Chamada genérica ─────────────────────────────────────────────────────────
async function call(webhookUrl, method, params = {}) {
  const url = `${webhookUrl.replace(/\/$/, '')}/${method}`;
  try {
    const response = await axios.post(url, params, { timeout: 20000 });
    return response.data;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    throw new Error(`Erro na API Bitrix24 [${method}]: ${msg}`);
  }
}

// ─── Busca paginada de atividades do Open Channel via crm.activity.list ───────
// TYPE_ID=6 + SUBJECT contendo "Canal Aberto" = conversas do WhatsApp/Open Channel
async function getOpenChannelActivities(webhookUrl, { dateFrom, dateTo } = {}) {
  const cacheKey = `activities_${webhookUrl}_${dateFrom}_${dateTo}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const filter = {
    'TYPE_ID': '6',
    '%SUBJECT': 'Canal Aberto'
  };
  if (dateFrom) filter['>=START_TIME'] = `${dateFrom}T00:00:00`;
  if (dateTo)   filter['<=START_TIME'] = `${dateTo}T23:59:59`;

  let start = 0;
  let allActivities = [];

  while (true) {
    const res = await call(webhookUrl, 'crm.activity.list', {
      filter,
      select: ['ID', 'SUBJECT', 'START_TIME', 'END_TIME', 'RESPONSIBLE_ID', 'PROVIDER_TYPE_ID'],
      order: { ID: 'DESC' },
      start
    });

    const items = res.result || [];
    allActivities = allActivities.concat(items);

    const total = res.total || 0;
    start += 50;

    if (start >= total || items.length === 0) break;

    // Proteção: máximo 5000 registros por busca para não travar
    if (allActivities.length >= 5000) break;
  }

  cache.set(cacheKey, allActivities);
  return allActivities;
}

// ─── Busca mensagens de uma sessão via imopenlines.session.history.get ────────
// PROVIDER_TYPE_ID da atividade = SESSION_ID do Open Channel
async function getSessionMessages(webhookUrl, sessionId) {
  const cacheKey = `session_msgs_${webhookUrl}_${sessionId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await call(webhookUrl, 'imopenlines.session.history.get', {
      SESSION_ID: sessionId
    });

    // Retorna objeto com IDs como chaves — converte para array
    const msgObj = res.result?.message || {};
    const messages = Object.values(msgObj).map(m => ({
      id: m.id,
      date: m.date,
      senderId: String(m.senderid || '0'),
      text: m.text,
      params: m.params || {}
    }));

    cache.set(cacheKey, messages);
    return messages;
  } catch {
    return [];
  }
}

// ─── Busca operadores (usuários ativos) ───────────────────────────────────────
async function getOperators(webhookUrl) {
  const cacheKey = `operators_${webhookUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let start = 0;
  let allUsers = [];

  while (true) {
    const res = await call(webhookUrl, 'user.get', {
      FILTER: { ACTIVE: true },
      SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL'],
      start
    });
    const users = res.result || [];
    allUsers = allUsers.concat(users);
    const total = res.total || 0;
    start += 50;
    if (start >= total || users.length === 0) break;
  }

  const mapped = allUsers.map(u => ({
    id: String(u.ID),
    name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || u.EMAIL || `Usuário ${u.ID}`
  }));

  cache.set(cacheKey, mapped);
  return mapped;
}

// ─── Extrai nome do cliente do SUBJECT da atividade ──────────────────────────
// Formato: 'Bate-papo do Canal Aberto: "NOME - CANAL" (Whatsapp)'
function extractClientName(subject) {
  try {
    const match = subject.match(/:"([^"]+)"/);
    if (match) {
      // Remove o sufixo do canal (ex: " - WhatsApp - ABAEDU OFICIAL")
      const parts = match[1].split(' - ');
      return parts[0].trim();
    }
  } catch {}
  return subject || 'Cliente';
}

// ─── Extrai canal do SUBJECT ──────────────────────────────────────────────────
function extractChannel(subject) {
  try {
    const match = subject.match(/\(([^)]+)\)$/);
    return match ? match[1] : 'WhatsApp';
  } catch {}
  return 'WhatsApp';
}

// ─── Calcula métricas de uma atividade + suas mensagens ──────────────────────
function calcActivityMetrics(activity, messages) {
  const activityId  = activity.ID;
  const operatorId  = String(activity.RESPONSIBLE_ID || '');
  const clientName  = extractClientName(activity.SUBJECT);
  const channel     = extractChannel(activity.SUBJECT);
  const dateCreate  = new Date(activity.START_TIME);
  const dateClose   = activity.END_TIME ? new Date(activity.END_TIME) : null;

  // Tempo total de atendimento (segundos)
  const totalTime = dateClose && dateClose > dateCreate
    ? (dateClose - dateCreate) / 1000
    : null;

  if (!messages || messages.length === 0) {
    return {
      activityId, operatorId, clientName, channel,
      dateCreate: dateCreate.toISOString(),
      dateClose: dateClose?.toISOString() || null,
      firstResponseTime: null,
      avgResponseTime: null,
      totalTime,
      messageCount: 0,
      status: dateClose ? 'closed' : 'open'
    };
  }

  // Ordena por data
  const sorted = [...messages]
    .filter(m => m.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sorted.length === 0) {
    return {
      activityId, operatorId, clientName, channel,
      dateCreate: dateCreate.toISOString(),
      dateClose: dateClose?.toISOString() || null,
      firstResponseTime: null,
      avgResponseTime: null,
      totalTime,
      messageCount: messages.length,
      status: dateClose ? 'closed' : 'open'
    };
  }

  // Identifica cliente: primeiro remetente não-sistema (senderid != "0")
  const firstClientMsg = sorted.find(m => m.senderId !== '0');
  const clientSenderId = firstClientMsg?.senderId || '';

  // Primeira mensagem do operador (diferente do cliente e não sistema)
  const firstOperatorMsg = sorted.find(m =>
    m.senderId !== '0' &&
    m.senderId !== clientSenderId &&
    m.senderId !== ''
  );

  // Tempo de primeira resposta
  let firstResponseTime = null;
  if (firstClientMsg && firstOperatorMsg) {
    const diff = (new Date(firstOperatorMsg.date) - new Date(firstClientMsg.date)) / 1000;
    if (diff >= 0) firstResponseTime = diff;
  }

  // Tempo médio de resposta do operador
  const responseTimes = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    // Cliente enviou → operador respondeu
    if (
      prev.senderId === clientSenderId &&
      curr.senderId !== clientSenderId &&
      curr.senderId !== '0'
    ) {
      const diff = (new Date(curr.date) - new Date(prev.date)) / 1000;
      if (diff > 0 && diff < 86400) responseTimes.push(diff);
    }
  }

  const avgResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : firstResponseTime;

  return {
    activityId, operatorId, clientName, channel,
    dateCreate: dateCreate.toISOString(),
    dateClose: dateClose?.toISOString() || null,
    firstResponseTime,
    avgResponseTime,
    totalTime,
    messageCount: sorted.length,
    status: dateClose ? 'closed' : 'open'
  };
}

// ─── Limpa cache de um tenant ─────────────────────────────────────────────────
function clearCache(webhookUrl) {
  const keys = cache.keys().filter(k => k.includes(webhookUrl));
  keys.forEach(k => cache.del(k));
}

module.exports = {
  call,
  getOpenChannelActivities,
  getSessionMessages,
  getOperators,
  calcActivityMetrics,
  clearCache
};
