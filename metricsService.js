// src/services/metricsService.js
const bitrixService = require('./bitrixService');

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

async function getMetrics(webhookUrl, { dateFrom, dateTo, operatorId } = {}) {
  // 1. Busca todas as atividades do Open Channel no período
  const activities = await bitrixService.getOpenChannelActivities(webhookUrl, { dateFrom, dateTo });

  // 2. Busca operadores
  const operators = await bitrixService.getOperators(webhookUrl);
  const operatorMap = Object.fromEntries(operators.map(o => [o.id, o.name]));

  // 3. Para cada atividade, busca mensagens e calcula métricas
  // Processa em paralelo em grupos de 5
  const allMetrics = [];
  const chunkSize = 5;

  for (let i = 0; i < activities.length; i += chunkSize) {
    const chunk = activities.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (activity) => {
        try {
          const sessionId = activity.PROVIDER_TYPE_ID;
          let messages = [];
          if (sessionId) {
            messages = await bitrixService.getSessionMessages(webhookUrl, sessionId);
          }
          return bitrixService.calcActivityMetrics(activity, messages);
        } catch {
          // Se falhar ao buscar mensagens, calcula métricas sem elas
          return bitrixService.calcActivityMetrics(activity, []);
        }
      })
    );
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value) allMetrics.push(r.value);
    });
  }

  // 4. Filtra por operador se solicitado
  const filtered = operatorId
    ? allMetrics.filter(m => m.operatorId === String(operatorId))
    : allMetrics;

  // 5. Indicadores globais
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

  // 6. Agrega por operador
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

  // 7. Tabela detalhada
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
    generatedAt: new Date().toISOString()
  };
}

module.exports = { getMetrics, formatDuration };
