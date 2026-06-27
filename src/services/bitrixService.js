// src/services/bitrixService.js
const axios = require('axios');
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: parseInt(process.env.CACHE_TTL || '300') });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(webhookUrl, method, params = {}) {
  const url = `${webhookUrl.replace(/\/$/, '')}/${method}`;
  try {
    const response = await axios.post(url, params, { timeout: 60000 });
    return response.data;
  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    throw new Error(`Erro na API Bitrix24 [${method}]: ${msg}`);
  }
}

function flattenParams(params = {}, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(params)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenParams(val, fullKey));
    } else if (Array.isArray(val)) {
      val.forEach((v, i) => { result[`${fullKey}[${i}]`] = v; });
    } else {
      result[fullKey] = val;
    }
  }
  return result;
}

async function batch(webhookUrl, commands) {
  const url = `${webhookUrl.replace(/\/$/, '')}/batch`;
  const chunks = [];
  for (let i = 0; i < commands.length; i += 50) {
    chunks.push(commands.slice(i, i + 50));
  }

  const allResults = {};
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const cmd = {};
    chunk.forEach(({ key, method, params }) => {
      cmd[key] = `${method}?${new URLSearchParams(flattenParams(params)).toString()}`;
    });
    try {
      const response = await axios.post(url, { cmd }, { timeout: 60000 });
      const result = response.data?.result?.result || {};
      Object.assign(allResults, result);
    } catch (err) {
      console.error('[batch] Erro:', err.message);
    }
    if (i < chunks.length - 1) await sleep(550);
  }
  return allResults;
}

async function getOpenChannelActivities(webhookUrl, { dateFrom, dateTo, operatorId } = {}) {
  const cacheKey = `activities_${webhookUrl}_${dateFrom}_${dateTo}_${operatorId || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const filter = { 'TYPE_ID': '6', '%SUBJECT': 'Canal Aberto' };
  if (dateFrom) filter['>=START_TIME'] = `${dateFrom}T00:00:00`;
  if (dateTo)   filter['<=START_TIME'] = `${dateTo}T23:59:59`;
  if (operatorId) filter['RESPONSIBLE_ID'] = String(operatorId);

  const select = ['ID', 'SUBJECT', 'START_TIME', 'END_TIME', 'RESPONSIBLE_ID', 'ASSOCIATED_ENTITY_ID', 'COMPLETED', 'STATUS'];

  let start = 0;
  let allActivities = [];

  while (true) {
    const res = await call(webhookUrl, 'crm.activity.list', {
      filter, select, order: { ID: 'DESC' }, start
    });

    const items = res.result || [];
    allActivities = allActivities.concat(items);

    const total = res.total || 0;
    console.log(`[activities] start=${start} total=${total} fetched=${allActivities.length}`);

    start += 50;
    if (start >= total || items.length === 0) break;
    if (allActivities.length >= 5000) break;

      }

  cache.set(cacheKey, allActivities);
  return allActivities;
}

async function getSessionMessagesBatch(webhookUrl, sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return {};

  const toFetch = [];
  const results = {};

  for (const sid of sessionIds) {
    const cacheKey = `session_msgs_${webhookUrl}_${sid}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      results[sid] = cached;
    } else {
      toFetch.push(sid);
    }
  }

  if (toFetch.length === 0) return results;

  const commands = toFetch.map(sid => ({
    key: `session_${sid}`,
    method: 'imopenlines.session.history.get',
    params: { SESSION_ID: sid }
  }));

  const batchResults = await batch(webhookUrl, commands);

  for (const sid of toFetch) {
    const key = `session_${sid}`;
    const raw = batchResults[key];
    const msgObj = raw?.message || {};
    const messages = Object.values(msgObj).map(m => ({
      id: m.id,
      date: m.date,
      senderId: String(m.senderid || '0'),
      text: m.text,
      params: m.params || {}
    }));
    const cacheKey = `session_msgs_${webhookUrl}_${sid}`;
    cache.set(cacheKey, messages);
    results[sid] = messages;
  }

  return results;
}

async function getOperators(webhookUrl) {
  const cacheKey = `operators_${webhookUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const firstRes = await call(webhookUrl, 'user.get', {
    FILTER: { ACTIVE: true },
    SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL'],
    start: 0
  });

  let allUsers = firstRes.result || [];
  const total = firstRes.total || 0;

  if (total > 50) {
    const commands = [];
    for (let start = 50; start < total; start += 50) {
      commands.push({
        key: `users_${start}`,
        method: 'user.get',
        params: {
          FILTER: { ACTIVE: true },
          SELECT: { 0: 'ID', 1: 'NAME', 2: 'LAST_NAME', 3: 'EMAIL' },
          start
        }
      });
    }
    const batchResults = await batch(webhookUrl, commands);
    for (const key of Object.keys(batchResults)) {
      const items = batchResults[key] || [];
      if (Array.isArray(items)) allUsers = allUsers.concat(items);
    }
  }

  const mapped = allUsers.map(u => ({
    id: String(u.ID),
    name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || u.EMAIL || `Usuário ${u.ID}`
  }));

  cache.set(cacheKey, mapped);
  return mapped;
}

function extractClientName(subject) {
  try {
    const match = subject.match(/:"([^"]+)"/);
    if (match) return match[1].split(' - ')[0].trim();
  } catch {}
  return subject || 'Cliente';
}

function extractChannel(subject) {
  try {
    const match = subject.match(/\(([^)]+)\)$/);
    return match ? match[1] : 'WhatsApp';
  } catch {}
  return 'WhatsApp';
}

function calcActivityMetrics(activity, messages) {
  const activityId = activity.ID;
  const operatorId = String(activity.RESPONSIBLE_ID || '');
  const clientName = extractClientName(activity.SUBJECT);
  const channel    = extractChannel(activity.SUBJECT);
  const dateCreate = new Date(activity.START_TIME);

  // Tempo total: usa última mensagem do histórico como encerramento real
  // ignora END_TIME do CRM pois é data de atualização, não encerramento
  let dateClose = null;
  let totalTime = null;

  if (messages && messages.length > 0) {
    const sorted = [...messages]
      .filter(m => m.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    if (sorted.length > 0) {
      const lastMsg = sorted[sorted.length - 1];
      dateClose = new Date(lastMsg.date);
      totalTime = (dateClose - dateCreate) / 1000;

      // Ignora conversas com tempo > 24h (ficaram abertas sem encerramento real)
      if (totalTime > 86400) {
        totalTime = null;
        dateClose = null;
      }
    }

    // Identifica cliente e operador pelas mensagens
    const firstClientMsg   = sorted.find(m => m.senderId !== '0');
    const clientSenderId   = firstClientMsg?.senderId || '';
    const firstOperatorMsg = sorted.find(m =>
      m.senderId !== '0' && m.senderId !== clientSenderId && m.senderId !== ''
    );

    let firstResponseTime = null;
    if (firstClientMsg && firstOperatorMsg) {
      const diff = (new Date(firstOperatorMsg.date) - new Date(firstClientMsg.date)) / 1000;
      if (diff >= 0 && diff < 86400) firstResponseTime = diff;
    }

    const responseTimes = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.senderId === clientSenderId && curr.senderId !== clientSenderId && curr.senderId !== '0') {
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

  return {
    activityId, operatorId, clientName, channel,
    dateCreate: dateCreate.toISOString(),
    dateClose: null,
    firstResponseTime: null,
    avgResponseTime: null,
    totalTime: null,
    messageCount: 0,
    status: 'open'
  };
}

function clearCache(webhookUrl) {
  const keys = cache.keys().filter(k => k.includes(webhookUrl));
  keys.forEach(k => cache.del(k));
}

module.exports = {
  call, batch,
  getOpenChannelActivities,
  getSessionMessagesBatch,
  getOperators,
  calcActivityMetrics,
  extractClientName,
  extractChannel,
  clearCache
};
