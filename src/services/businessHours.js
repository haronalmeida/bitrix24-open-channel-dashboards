// src/services/businessHours.js
const DEFAULT_BH = { start: 9, end: 18, days: [1,2,3,4,5] };

function parseBH(tenant) {
  return tenant?.businessHours || DEFAULT_BH;
}

// Retorna o próximo momento dentro do horário comercial
function nextBusinessMoment(date, bh) {
  const d = new Date(date);
  const { start, end, days } = bh;
  for (let attempt = 0; attempt < 14; attempt++) {
    const day = d.getDay();
    const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    if (days.includes(day)) {
      if (hour >= start && hour < end) return new Date(d);
      if (hour < start) { d.setHours(start, 0, 0, 0); return new Date(d); }
    }
    d.setDate(d.getDate() + 1);
    d.setHours(start, 0, 0, 0);
  }
  return new Date(date);
}

// Calcula segundos de tempo útil entre dois momentos
function businessTimeDiff(from, to, bh) {
  if (!from || !to) return null;
  const { start, end, days } = bh;
  let current = new Date(from);
  const target = new Date(to);
  if (current >= target) return 0;
  let totalSeconds = 0;
  let iterations = 0;
  while (current < target && iterations++ < 10000) {
    const day = current.getDay();
    const hour = current.getHours() + current.getMinutes() / 60 + current.getSeconds() / 3600;
    if (!days.includes(day) || hour >= end) {
      current.setDate(current.getDate() + 1);
      current.setHours(start, 0, 0, 0);
      continue;
    }
    if (hour < start) { current.setHours(start, 0, 0, 0); continue; }
    const endOfDay = new Date(current);
    endOfDay.setHours(end, 0, 0, 0);
    const nextMoment = target < endOfDay ? target : endOfDay;
    totalSeconds += (nextMoment - current) / 1000;
    current = nextMoment;
  }
  return Math.round(totalSeconds);
}

// Se a mensagem chegou fora do horário, retorna o início do próximo expediente
function effectiveTime(date, bh) {
  return nextBusinessMoment(date, bh);
}

module.exports = { parseBH, businessTimeDiff, effectiveTime, DEFAULT_BH };
