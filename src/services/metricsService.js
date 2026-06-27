// src/services/metricsService.js
const bitrixService = require('./bitrixService');
const { businessTimeDiff, effectiveTime } = require('./businessHours');

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function avg(arr) {
  const valid = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

async function getMetrics(webhookUrl, { dateFrom, dateTo, operatorIds = [] } = {}, bh = null) {
  // 1. Busca atividades com filtro de operador direto na API
  // Busca atividades filtrando por operador diretamente na API
  let activities = [];
  if (operatorIds.length === 0) {
    // Sem filtro — busca tudo
    activities = await bitrixService.getOpenChannelActivities(webhookUrl, { dateFrom, dateTo });
  } else {
    // Busca por cada operador separadamente e combina
    const results = await Promise.all(
      operatorIds.map(opId => bitrixService.getOpenChannelActivities(webhookUrl, { dateFrom, dateTo, operatorId: opId }))
    );
    activities = results.flat();
  }

  // 2. Busca operadores
  const operators = await bitrixService.getOperators(webhookUrl);
  const operatorMap = Object.fromEntries(operators.map(o => [o.id, o.name]));

  // 3. Coleta SESSION IDs e busca mensagens via batch
  const sessionIds = activities
    .map(a => a.ASSOCIATED_ENTITY_ID)
    .filter(id => id && id !== '0' && id !== '');

  const messagesMap = await bitrixService.getSessionMessagesBatch(webhookUrl, sessionIds);

  // 4. Calcula métricas para cada atividade aplicando horário comercial
  const allMetrics = activities.map(activity => {
    const sessionId = activity.ASSOCIATED_ENTITY_ID;
    const messages  = messagesMap[sessionId] || [];
    return calcMetricsWithBH(activity, messages, bh);
  });

  // 5. Filtra (segurança — já vem filtrado da API, mas garante)
  const filtered = operatorIds.length > 0
    ? allMetrics.filter(m => operatorIds.includes(m.operatorId))
    : allMetrics;

  // 6. Indicadores globais
  const firstResponseTimes = filtered.map(m => m.firstResponseTime).filter(v => v !== null);
  const avgResponseTimes   = filtered.map(m => m.avgResponseTime).filter(v => v !== null);
  const totalTimes         = filtered.map(m => m.totalTime).filter(v => v !== null && v > 0);

  const summary = {
    totalSessions: filtered.length,
    openSessions: filtered.filter(m => m.status === 'open').length,
    closedSessions: filtered.filter(m => m.status === 'closed').length,
    avgFirstResponseTime: avg(firstResponseTimes),
    minFirstResponseTime: firstResponseTimes.length ? Math.min(...firstResponseTimes) : null,
    maxFirstResponseTime: firstResponseTimes.length ? Math.max(...firstResponseTimes) : null,
    avgResponseTime: avg(avgResponseTimes),
    avgTotalTime: avg(totalTimes),
    minTotalTime: totalTimes.length ? Math.min(...totalTimes) : null,
    maxTotalTime: totalTimes.length ? Math.max(...totalTimes) : null,
  };

  // 7. Agrega por operador
  const byOperator = {};
  filtered.forEach(m => {
    const opId = m.operatorId || 'unknown';
    if (!byOperator[opId]) {
      byOperator[opId] = {
        operatorId: opId,
        operatorName: operatorMap[opId] || `Operador ${opId}`,
        firstResponseTimes: [],
        avgResponseTimes: [],
        totalTimes: [],
        count: 0
      };
    }
    byOperator[opId].count++;
    if (m.firstResponseTime !== null) byOperator[opId].firstResponseTimes.push(m.firstResponseTime);
    if (m.avgResponseTime !== null)   byOperator[opId].avgResponseTimes.push(m.avgResponseTime);
    if (m.totalTime !== null && m.totalTime > 0) byOperator[opId].totalTimes.push(m.totalTime);
  });

  const operatorStats = Object.values(byOperator).map(op => ({
    operatorId: op.operatorId,
    operatorName: op.operatorName,
    totalSessions: op.count,
    avgFirstResponseTime: avg(op.firstResponseTimes),
    avgFirstResponseTimeFormatted: formatDuration(avg(op.firstResponseTimes)),
    avgResponseTime: avg(op.avgResponseTimes),
    avgResponseTimeFormatted: formatDuration(avg(op.avgResponseTimes)),
    avgTotalTime: avg(op.totalTimes),
    avgTotalTimeFormatted: formatDuration(avg(op.totalTimes)),
  })).sort((a, b) => b.totalSessions - a.totalSessions);

  // 8. Tabela detalhada
  const table = filtered.map(m => ({
    sessionId: m.activityId,
    operatorId: m.operatorId,
    operatorName: operatorMap[m.operatorId] || `Operador ${m.operatorId}`,
    clientName: m.clientName,
    channel: m.channel,
    dateCreate: m.dateCreate,
    dateClose: m.dateClose,
    status: m.status,
    messageCount: m.messageCount,
    firstResponseTime: m.firstResponseTime,
    firstResponseTimeFormatted: formatDuration(m.firstResponseTime),
    avgResponseTime: m.avgResponseTime,
    avgResponseTimeFormatted: formatDuration(m.avgResponseTime),
    totalTime: m.totalTime,
    totalTimeFormatted: formatDuration(m.totalTime),
  })).sort((a, b) => new Date(b.dateCreate) - new Date(a.dateCreate));

  return {
    summary: {
      ...summary,
      avgFirstResponseTimeFormatted: formatDuration(summary.avgFirstResponseTime),
      avgResponseTimeFormatted: formatDuration(summary.avgResponseTime),
      avgTotalTimeFormatted: formatDuration(summary.avgTotalTime),
      minFirstResponseTimeFormatted: formatDuration(summary.minFirstResponseTime),
      maxFirstResponseTimeFormatted: formatDuration(summary.maxFirstResponseTime),
      minTotalTimeFormatted: formatDuration(summary.minTotalTime),
      maxTotalTimeFormatted: formatDuration(summary.maxTotalTime),
    },
    operatorStats,
    operators,
    table,
    businessHours: bh,
    generatedAt: new Date().toISOString()
  };
}

// Calcula métricas de uma atividade com desconto de horário comercial
function calcMetricsWithBH(activity, messages, bh) {
  const activityId = activity.ID;
  const operatorId = String(activity.RESPONSIBLE_ID || '');
  const clientName = extractClientName(activity.SUBJECT);
  const channel    = extractChannel(activity.SUBJECT);
  const dateCreate = new Date(activity.START_TIME);

  if (!messages || messages.length === 0) {
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

  const sorted = [...messages]
    .filter(m => m.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (sorted.length === 0) {
    return {
      activityId, operatorId, clientName, channel,
      dateCreate: dateCreate.toISOString(),
      dateClose: null,
      firstResponseTime: null,
      avgResponseTime: null,
      totalTime: null,
      messageCount: messages.length,
      status: 'open'
    };
  }

  // Identifica cliente e operador
  const firstClientMsg   = sorted.find(m => m.senderId !== '0');
  const clientSenderId   = firstClientMsg?.senderId || '';
  const firstOperatorMsg = sorted.find(m =>
    m.senderId !== '0' && m.senderId !== clientSenderId && m.senderId !== ''
  );

  // Tempo de 1ª resposta — com desconto de horário comercial
  let firstResponseTime = null;
  if (firstClientMsg && firstOperatorMsg) {
    const clientMsgDate = new Date(firstClientMsg.date);
    const operatorMsgDate = new Date(firstOperatorMsg.date);

    if (bh) {
      // Usa tempo útil: se cliente mandou fora do horário,
      // conta a partir do início do próximo expediente
      const effectiveStart = effectiveTime(clientMsgDate, bh);
      firstResponseTime = businessTimeDiff(effectiveStart, operatorMsgDate, bh);
    } else {
      const diff = (operatorMsgDate - clientMsgDate) / 1000;
      if (diff >= 0) firstResponseTime = diff;
    }
  }

  // Tempo médio de resposta — com desconto de horário comercial
  const responseTimes = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (prev.senderId === clientSenderId && curr.senderId !== clientSenderId && curr.senderId !== '0') {
      const prevDate = new Date(prev.date);
      const currDate = new Date(curr.date);
      let diff;
      if (bh) {
        const effectiveStart = effectiveTime(prevDate, bh);
        diff = businessTimeDiff(effectiveStart, currDate, bh);
      } else {
        diff = (currDate - prevDate) / 1000;
      }
      if (diff !== null && diff >= 0 && diff < 86400) responseTimes.push(diff);
    }
  }

  const avgResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : firstResponseTime;

  // Tempo total de atendimento — usa última mensagem como encerramento
  const lastMsg = sorted[sorted.length - 1];
  const dateClose = new Date(lastMsg.date);
  let totalTime = null;

  if (bh) {
    totalTime = businessTimeDiff(dateCreate, dateClose, bh);
  } else {
    totalTime = (dateClose - dateCreate) / 1000;
    if (totalTime > 86400) totalTime = null; // ignora > 24h sem horário comercial
  }

  return {
    activityId, operatorId, clientName, channel,
    dateCreate: dateCreate.toISOString(),
    dateClose: dateClose.toISOString(),
    firstResponseTime,
    avgResponseTime,
    totalTime,
    messageCount: sorted.length,
    status: activity.COMPLETED === 'Y' ? 'closed' : 'open'
  };
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

module.exports = { getMetrics, formatDuration };
