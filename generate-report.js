// generate-report.js — HTML Report Generator

const fs   = require('fs');
const path = require('path');

function getTodayStr() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function formatGeneratedTime(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function parseDayHeader(raw) {
  if (!raw) return { weekday: '?', date: '', dateObj: null };
  const clean = raw.replace(/\n/g, ' ').trim();
  const weekdayMatch = clean.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  const dateMatch    = clean.match(/(\d+)\/(\d+)\/(\d{4})/);
  let dateObj = null;
  if (dateMatch) {
    dateObj = new Date(parseInt(dateMatch[3]), parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2]));
  }
  return {
    weekday: weekdayMatch ? weekdayMatch[1] : clean.split(' ')[0],
    date:    dateMatch ? dateMatch[0] : '',
    dateObj,
  };
}


// ─── BUILD ONE SALON/WEEK TABLE ───────────────────────────────────────────────

function buildTable(salon) {
  const days      = salon.weekDates || [];
  const employees = salon.employees || [];
  const recHours  = salon.recommendedHours || [];

  if (!days.length || !employees.length) {
    return `<div class="no-data">No schedule data available.</div>`;
  }

  const dayMeta = days.map(d => parseDayHeader(d));

  // Header row
  const thHtml = dayMeta.map((d, i) => {
    const dateAttr = d.date ? ` data-date="${d.date}"` : '';
    return `<th${dateAttr}>
      <span class="day-name">${d.weekday.substring(0,3)}</span>
      <span class="day-date">${d.date}</span>
    </th>`;
  }).join('');

  // Employee rows
  const rowsHtml = employees.map(emp => {
    const hoursDisplay = emp.totalHours != null ? `${emp.totalHours}h` : '—';

    const cellsHtml = dayMeta.map((d, i) => {
      const shift   = emp.schedule[days[i]];
      const working = !!shift;
      const dateAttr = d.date ? ` data-date="${d.date}"` : '';
      return `<td${dateAttr} class="${working ? 'working' : 'off'}">
        ${working ? `<span class="shift">${shift}</span>` : `<span class="dash">—</span>`}
      </td>`;
    }).join('');

    // Store which dates this employee works so JS can set row-today dynamically
    const workDates = dayMeta
      .filter((d, i) => d.date && emp.schedule[days[i]])
      .map(d => d.date);
    const workDatesAttr = workDates.length ? ` data-work-dates="${workDates.join(',')}"` : '';

    return `<tr${workDatesAttr}>
      <td class="emp-name">
        <span class="emp-name-inner">
          <span class="dot" style="display:none"></span>
          <span class="name-text">${emp.name}</span>
        </span>
      </td>
      ${cellsHtml}
      <td class="total-hrs">${hoursDisplay}</td>
    </tr>`;
  }).join('');

  // Per-day scheduled floor hours (sum of hours worked each day)
  const dailyTotals = days.map((day) => {
    return employees.reduce((sum, emp) => {
      const shift = emp.schedule[day];
      if (!shift) return sum;

      // Some shifts have multiple lines e.g. "9 - 12p\n2 - 7p" — split and sum each
      const lines = shift.split(/\n/).map(s => s.trim()).filter(Boolean);
      let dayHrs = 0;

      for (const line of lines) {
        // Skip annotations like "Leave Early", "OFF" etc.
        if (!/\d/.test(line)) continue;

        // Match "H:MM - H:MMp" or "H - Hp" with optional minutes
        const m = line.match(/(\d+)(?::(\d+))?\s*[-–]\s*(\d+)(?::(\d+))?\s*([ap])/i);
        if (!m) continue;

        let startH = parseInt(m[1]);
        const startMin = parseInt(m[2] || 0);
        let endH   = parseInt(m[3]);
        const endMin = parseInt(m[4] || 0);
        const isPM = m[5].toLowerCase() === 'p';

        // Convert end time
        if (isPM && endH !== 12) endH += 12;
        if (!isPM && endH === 12) endH = 0;

        // Convert start time — if start >= end after PM conversion, start is also PM
        // e.g. "1:30 - 6p": start=1, end=18 → start must be 13 (1pm)
        // e.g. "8 - 3p": start=8, end=15 → start stays 8am (8 < 15 already)
        // e.g. "12 - 7p": start=12, end=19 → 12 = noon, stays 12
        if (startH !== 12 && startH + 12 <= endH && startH < 12) {
          // start is ambiguous — only add 12 if it makes sense
          // Rule: if start < 7, it's likely PM (e.g. 1:30p, 2p, 3p)
          if (startH < 7) startH += 12;
        }

        const startDecimal = startH + startMin / 60;
        const endDecimal   = endH   + endMin   / 60;
        const hrs = endDecimal > startDecimal ? endDecimal - startDecimal : 0;
        dayHrs += hrs;
      }

      return sum + dayHrs;
    }, 0);
  });

  const scheduledRowHtml = `
    <tr class="scheduled-row">
      <td class="rec-label">Scheduled Floor Hrs</td>
      ${dailyTotals.map((h, i) => {
        const dateAttr = dayMeta[i] && dayMeta[i].date ? ` data-date="${dayMeta[i].date}"` : '';
        return `<td${dateAttr} class="rec-cell">${h > 0 ? h.toFixed(1) : '—'}</td>`;
      }).join('')}
      <td class="rec-total">${dailyTotals.reduce((s, v) => s + v, 0).toFixed(1)}</td>
    </tr>`;

  // Recommended floor hours row
  const recRowHtml = recHours.length ? `
    <tr class="rec-row">
      <td class="rec-label">Recommended Floor Hrs</td>
      ${recHours.map((h, i) => {
        const dateAttr = dayMeta[i] && dayMeta[i].date ? ` data-date="${dayMeta[i].date}"` : '';
        return `<td${dateAttr} class="rec-cell">${h || '—'}</td>`;
      }).join('')}
      <td class="rec-total">${recHours.reduce((s, v) => s + (parseFloat(v) || 0), 0).toFixed(1)}</td>
    </tr>` : '';

  return `
    <div class="table-wrap">
      <table class="sched-table">
        <thead><tr>
          <th class="emp-col">Stylist</th>
          ${thHtml}
          <th class="total-col">Total</th>
        </tr></thead>
        <tbody>
          ${rowsHtml}
          ${scheduledRowHtml}
          ${recRowHtml}
        </tbody>
      </table>
    </div>`;
}

// ─── MAIN GENERATOR ───────────────────────────────────────────────────────────

function generateReport(data) {
  let weeks = [];
  if (data.weeks && data.weeks.length) {
    weeks = data.weeks;
  } else {
    weeks = [{ label: 'This Week', weekEnding: data.weekEnding || '', salons: data.salons || [] }];
  }

  // Collect all unique salons
  const salonMap = {};
  weeks.forEach(week => {
    (week.salons || []).forEach(s => {
      if (!salonMap[s.salonId]) salonMap[s.salonId] = s.salonName;
    });
  });
  const salonIds = Object.keys(salonMap);

  // Drop entries whose end date has already passed — keeps stale promos/holidays
  // from lingering on the live report between scrapes.
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  function isStillCurrent(entry) {
    if (!entry || !entry.dates) return true; // no date info → keep it
    // Match the second (end) date of the range, e.g. "3/24/26 - 4/10/26"
    const m = entry.dates.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return true;
    let year = parseInt(m[6], 10);
    if (year < 100) year += 2000;
    const endDate = new Date(year, parseInt(m[4], 10) - 1, parseInt(m[5], 10));
    return endDate >= todayMidnight;
  }

  const promotions  = (data.knownPromotions || []).filter(isStillCurrent);
  const specialDays = (data.specialDays || []).filter(isStillCurrent);
  const generatedAt = data.generatedAt || new Date().toISOString();

  // Pre-build all tables
  const tableData = {};
  weeks.forEach((week, wi) => {
    tableData[wi] = {};
    (week.salons || []).forEach(salon => {
      tableData[wi][salon.salonId] = buildTable(salon);
    });
  });

  const tableDataJson  = JSON.stringify(tableData).replace(/</g,'\\u003c').replace(/>/g,'\\u003e');
  const weekLabels     = weeks.map(w => w.label || 'Week');
  const weekLabelsJson = JSON.stringify(weekLabels);
  const salonIdsJson   = JSON.stringify(salonIds);
  const salonNamesJson = JSON.stringify(salonMap);

  // Promotions section (bottom)
  const promosHtml = promotions.map(p => `
    <div class="promo-card">
      <div class="promo-card-name">${p.name}</div>
      <div class="promo-card-detail">${p.price} &nbsp;·&nbsp; ${p.dates}</div>
    </div>`).join('');

  const specialHtml = specialDays.map(s =>
    `<span class="special-pill">⭐ ${s.name} &nbsp;${s.dates}</span>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Salon Schedule</title>
<style>

/* ── Reset ───────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f4f6f0;
  color: #2d3322;
  min-height: 100vh;
  padding-bottom: 48px;
  font-size: 16px;
}

/* ── Color tokens ─────────────────────────────────────────────────────────
   Warm forest green palette
────────────────────────────────────────────────────────────────────────── */
:root {
  --brand-dark:   #2d4a22;
  --brand-mid:    #3d6b2e;
  --brand-accent: #6aaa3a;
  --brand-warm:   #c8861a;
  --brand-today:  #e8f5e0;
  --rec-bg:       #f0f7ea;
  --rec-text:     #2d4a22;
  --shift-bg:     #dff0ce;
  --shift-text:   #1e3a14;
  --today-shift-bg:   #fff3d0;
  --today-shift-text: #6b4200;
  --surface:      #ffffff;
  --border:       #dde5cc;
  --muted:        #7a8a68;
  --dot-color:    #6aaa3a;
}

/* ── Sticky header ────────────────────────────────────────────────────────── */
.site-header {
  background: linear-gradient(135deg, var(--brand-dark) 0%, var(--brand-mid) 100%);
  color: white;
  padding: 16px 16px 14px;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 14px rgba(0,0,0,0.3);
}
.header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
}
.header-title { font-size: 1.2rem; font-weight: 800; letter-spacing: -0.3px; }
.header-date  { font-size: 0.82rem; opacity: 0.75; margin-top: 3px; }
.updated-tag  { font-size: 0.72rem; opacity: 0.6; text-align: right; line-height: 1.6; white-space: nowrap; }

/* ── Tab bars ─────────────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 2px;
}
.tab-bar::-webkit-scrollbar { display: none; }
.tab-bar + .tab-bar { margin-top: 10px; }

.tab {
  flex-shrink: 0;
  padding: 8px 20px;
  border-radius: 22px;
  font-size: 0.9rem;
  font-weight: 700;
  border: 2px solid transparent;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
  letter-spacing: 0.1px;
}

/* Week tabs — inactive: solid dark border + white text; active: solid white fill */
.week-tab {
  background: transparent;
  color: white;
  border-color: rgba(255,255,255,0.5);
}
.week-tab.active {
  background: white;
  color: var(--brand-dark);
  border-color: white;
}

/* Salon tabs — inactive: subtle outline; active: bright green fill, dark text */
.salon-tab {
  background: rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.75);
  border-color: rgba(255,255,255,0.25);
}
.salon-tab.active {
  background: var(--brand-accent);
  color: #1a2e10;
  border-color: var(--brand-accent);
}

/* ── Special days bar ─────────────────────────────────────────────────────── */
.special-bar {
  background: var(--brand-warm);
  padding: 8px 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.special-pill { color: white; font-size: 0.9rem; font-weight: 700; }

/* ── Main content ─────────────────────────────────────────────────────────── */
.main { padding: 14px 12px 0; }
.salon-panel { display: none; }
.salon-panel.active { display: block; }

/* ── Table card ───────────────────────────────────────────────────────────── */
.table-wrap {
  background: var(--surface);
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.08);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--border);
}

.sched-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.93rem;
  min-width: 520px;
}

/* Header */
.sched-table thead th {
  background: var(--brand-dark);
  color: rgba(255,255,255,0.9);
  padding: 12px 8px 10px;
  text-align: center;
  border-right: 1px solid rgba(255,255,255,0.1);
}
.sched-table thead th:last-child { border-right: none; }
.sched-table thead th.emp-col {
  text-align: left;
  padding-left: 16px;
  min-width: 145px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: rgba(255,255,255,0.6);
  position: -webkit-sticky;
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--brand-dark);
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  box-shadow: 2px 0 4px -2px rgba(0,0,0,0.25);
}
.sched-table thead th.total-col {
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: rgba(255,255,255,0.6);
  min-width: 58px;
}
.day-name {
  display: block;
  font-weight: 800;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.day-date { display: block; font-size: 0.72rem; opacity: 0.65; margin-top: 2px; font-weight: 400; }
.today-pip {
  display: block;
  width: 6px; height: 6px;
  background: var(--brand-accent);
  border-radius: 50%;
  margin: 4px auto 0;
}

/* Today column in header */
thead th.today-col {
  background: var(--brand-mid);
  border-bottom: 3px solid var(--brand-accent);
}
thead th.today-col .day-name { color: #c8f096; }

/* Body cells */
.sched-table tbody td {
  padding: 11px 6px;
  text-align: center;
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  vertical-align: middle;
}
.sched-table tbody td:last-child { border-right: none; }
.sched-table tbody tr:last-child td { border-bottom: none; }
.sched-table tbody tr:hover td.emp-name { background: #f6faf0; }
.sched-table tbody tr:hover { background: #f6faf0; }

/* Emp name - sticky left column (pinned while scrolling horizontally on mobile) */
td.emp-name {
  text-align: left;
  padding-left: 14px;
  font-weight: 600;
  font-size: 0.92rem;
  color: #2d3322;
  white-space: nowrap;
  min-height: 42px;
  position: -webkit-sticky;
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--surface);
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  box-shadow: 2px 0 4px -2px rgba(0,0,0,0.15);
}
td.emp-name .emp-name-inner {
  display: flex;
  align-items: center;
  gap: 7px;
}
.dot {
  display: inline-block;
  width: 8px; height: 8px;
  background: var(--dot-color);
  border-radius: 50%;
  flex-shrink: 0;
}

/* Today column body */
tbody td.today-col { background: var(--brand-today); }

/* Shift badges */
.shift {
  display: inline-block;
  background: var(--shift-bg);
  color: var(--shift-text);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 0.82rem;
  font-weight: 700;
  white-space: nowrap;
  line-height: 1.3;
}
tbody td.today-col .shift {
  background: var(--today-shift-bg);
  color: var(--today-shift-text);
}
.dash { color: #c8d4b8; font-size: 1rem; }

/* Total hours column */
td.total-hrs {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--brand-mid);
  background: #f0f7e8;
}

/* Scheduled floor hours row */
tr.scheduled-row td {
  background: #eef5e8;
  border-top: 2px solid var(--border);
  padding-top: 10px;
  padding-bottom: 10px;
}
tr.scheduled-row td.today-col { background: #dff0ca; }
tr.scheduled-row td.rec-label { background: #eef5e8; }

/* Recommended floor hours row */
tr.rec-row td {
  background: var(--rec-bg);
  border-top: 2px solid var(--border);
  padding-top: 10px;
  padding-bottom: 10px;
}
tr.rec-row td.rec-label { background: var(--rec-bg); }
td.rec-label {
  text-align: left;
  padding-left: 14px;
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--rec-text);
  white-space: nowrap;
  position: -webkit-sticky;
  position: sticky;
  left: 0;
  z-index: 2;
  -webkit-transform: translateZ(0);
  transform: translateZ(0);
  box-shadow: 2px 0 4px -2px rgba(0,0,0,0.15);
}
td.rec-cell {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--rec-text);
}
td.rec-total {
  font-size: 0.88rem;
  font-weight: 800;
  color: var(--rec-text);
  background: #dff0ce;
}
tr.rec-row td.today-col { background: #d4edba; }

/* No data */
.no-data {
  padding: 36px;
  text-align: center;
  color: var(--muted);
  font-size: 1rem;
}

/* ── Promotions footer ────────────────────────────────────────────────────── */
.promo-section {
  margin: 20px 12px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.promo-section-header {
  background: var(--brand-warm);
  color: white;
  padding: 10px 18px;
  font-size: 0.8rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.promo-cards {
  background: white;
  display: flex;
  flex-wrap: wrap;
}
.promo-card {
  flex: 1 1 200px;
  padding: 16px 20px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.promo-card:last-child { border-right: none; }
.promo-card-name { font-weight: 800; font-size: 1rem; color: #2d3322; margin-bottom: 4px; }
.promo-card-detail { font-size: 0.85rem; color: var(--muted); }

/* ── Footer ───────────────────────────────────────────────────────────────── */
.footer {
  text-align: center;
  padding: 22px 16px;
  color: #aabA98;
  font-size: 0.75rem;
}

/* ── Mobile ───────────────────────────────────────────────────────────────── */
@media (max-width: 480px) {
  body { font-size: 15px; }
  .sched-table { font-size: 0.87rem; min-width: 460px; }
  .shift { font-size: 0.76rem; padding: 3px 6px; }
  td.emp-name { padding-left: 10px; min-width: 115px; font-size: 0.86rem; }
  .sched-table thead th { padding: 10px 4px 8px; }
  .sched-table tbody td { padding: 9px 4px; }
  .day-name { font-size: 0.78rem; }
  .day-date { font-size: 0.64rem; }
  td.total-hrs { font-size: 0.82rem; }
  .tab { padding: 7px 16px; font-size: 0.85rem; }
}

</style>
</head>
<body>

<!-- ── Sticky header ──────────────────────────────────────────────────────── -->
<header class="site-header">
  <div class="header-top">
    <div>
      <div class="header-title">✂️ Salon Schedules</div>
      <div class="header-date">${getTodayStr()}</div>
    </div>
    <div class="updated-tag">Updated<br>${formatGeneratedTime(generatedAt)}</div>
  </div>

  <div class="tab-bar" id="week-tabs">
    ${weekLabels.map((label, i) =>
      `<button class="tab week-tab ${i===0?'active':''}" onclick="selectWeek(${i})">${label}</button>`
    ).join('')}
  </div>

  <div class="tab-bar" id="salon-tabs">
    ${salonIds.map((id, i) =>
      `<button class="tab salon-tab ${i===0?'active':''}" onclick="selectSalon('${id}')">${salonMap[id].replace(/ #\d+/,'')}</button>`
    ).join('')}
  </div>
</header>

${specialDays.length ? `<div class="special-bar">${specialHtml}</div>` : ''}

<!-- ── Schedule panels ────────────────────────────────────────────────────── -->
<main class="main" id="main-content">
  ${salonIds.map((id, si) =>
    `<div class="salon-panel ${si===0?'active':''}" id="panel-${id}">
      ${weeks.map((_, wi) =>
        `<div class="week-panel" id="panel-${id}-w${wi}" style="display:${wi===0?'block':'none'}">
          ${(tableData[wi]&&tableData[wi][id]) ? tableData[wi][id] : '<div class="no-data">No data for this week.</div>'}
        </div>`
      ).join('')}
    </div>`
  ).join('')}
</main>

<!-- ── Promotions (bottom) ────────────────────────────────────────────────── -->
${promotions.length ? `
<div class="promo-section">
  <div class="promo-section-header">🎉 Current Promotions</div>
  <div class="promo-cards">${promosHtml}</div>
</div>` : ''}

<div class="footer">
  Auto-refreshes every other day &nbsp;·&nbsp; ${salonIds.length} locations
</div>

<script>
  const WEEK_LABELS = ${weekLabelsJson};
  const SALON_IDS   = ${salonIdsJson};
  const SALON_NAMES = ${salonNamesJson};

  function applyTodayHighlight() {
    const now = new Date();
    const todayStr = (now.getMonth() + 1) + '/' + now.getDate() + '/' + now.getFullYear();

    // Header <th> cells
    document.querySelectorAll('thead th[data-date]').forEach(th => {
      const isToday = th.dataset.date === todayStr;
      th.classList.toggle('today-col', isToday);
      // Add/remove the today pip
      let pip = th.querySelector('.today-pip');
      if (isToday && !pip) {
        pip = document.createElement('span');
        pip.className = 'today-pip';
        th.appendChild(pip);
      } else if (!isToday && pip) {
        pip.remove();
      }
    });

    // Body <td> cells
    document.querySelectorAll('tbody td[data-date]').forEach(td => {
      td.classList.toggle('today-col', td.dataset.date === todayStr);
    });

    // Employee rows: set row-today class and show/hide dot
    document.querySelectorAll('tr[data-work-dates]').forEach(tr => {
      const dates = tr.dataset.workDates.split(',');
      const working = dates.includes(todayStr);
      tr.classList.toggle('row-today', working);
      const dot = tr.querySelector('.dot');
      if (dot) dot.style.display = working ? '' : 'none';
    });
  }

  applyTodayHighlight();

  let currentWeek  = 0;
  let currentSalon = SALON_IDS[0];

  function selectWeek(wi) {
    currentWeek = wi;
    document.querySelectorAll('.week-tab').forEach((t,i) => t.classList.toggle('active', i===wi));
    showPanel();
  }

  function selectSalon(salonId) {
    currentSalon = salonId;
    document.querySelectorAll('.salon-tab').forEach(t => {
      const tid = t.getAttribute('onclick').match(/'([^']+)'/)[1];
      t.classList.toggle('active', tid === salonId);
    });
    document.querySelectorAll('.salon-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'panel-' + salonId);
    });
    showPanel();
  }

  function showPanel() {
    SALON_IDS.forEach(sid => {
      for (let wi = 0; wi < WEEK_LABELS.length; wi++) {
        const panel = document.getElementById('panel-' + sid + '-w' + wi);
        if (panel) panel.style.display = (sid===currentSalon && wi===currentWeek) ? 'block' : 'none';
      }
    });
  }
</script>

</body>
</html>`;

  const outputPath = path.join(__dirname, 'schedule_report.html');
  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`✅ Report generated: ${outputPath}`);
  return outputPath;
}

// ─── DEMO DATA ────────────────────────────────────────────────────────────────

function getDemoData() {
  const days  = ['Saturday\n3/28/2026','Sunday\n3/29/2026','Monday\n3/30/2026','Tuesday\n3/31/2026','Wednesday\n4/01/2026','Thursday\n4/02/2026','Friday\n4/03/2026'];
  const days2 = ['Saturday\n4/04/2026','Sunday\n4/05/2026','Monday\n4/06/2026','Tuesday\n4/07/2026','Wednesday\n4/08/2026','Thursday\n4/09/2026','Friday\n4/10/2026'];

  const makeSalons = (dl) => [
    {
      salonId:'3750', salonName:'Publix At County Line Road #3750', scrapedAt:new Date().toISOString(), weekDates:dl,
      recommendedHours:['18.0','18.0','20.0','20.0','20.0','20.0','20.0'],
      employees:[
        { name:'Lizbeth Jaquez (M)',         totalHours:31.0, schedule:{[dl[0]]:'9 - 2p',[dl[1]]:null,[dl[2]]:'9 - 3p',[dl[3]]:'9 - 3p',[dl[4]]:'9 - 3p',[dl[5]]:null,[dl[6]]:'9 - 3p'}},
        { name:'Amber Colding (S)',           totalHours:14.0, schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:'9 - 2p',[dl[3]]:'3 - 7p',[dl[4]]:null,[dl[5]]:'2 - 7p',[dl[6]]:null}},
        { name:'Elyssa Sutherland (S)',       totalHours:32.0, schedule:{[dl[0]]:null,[dl[1]]:'10 - 5p',[dl[2]]:'1 - 7p',[dl[3]]:'9 - 7p',[dl[4]]:'3 - 7p',[dl[5]]:'9 - 2p',[dl[6]]:null}},
        { name:'James B Fulmore (S)',         totalHours:31.0, schedule:{[dl[0]]:'12 - 6p',[dl[1]]:'10 - 5p',[dl[2]]:null,[dl[3]]:null,[dl[4]]:'12 - 7p',[dl[5]]:'9 - 2p',[dl[6]]:'1 - 7p'}},
        { name:'Rut E Garcia Rodriguez (S)', totalHours:16.5, schedule:{[dl[0]]:'1:30 - 6p',[dl[1]]:null,[dl[2]]:null,[dl[3]]:null,[dl[4]]:'9 - 12p',[dl[5]]:'2 - 7p',[dl[6]]:'3 - 7p'}},
      ]
    },
    {
      salonId:'3800', salonName:'Publix At Braden River #3800', scrapedAt:new Date().toISOString(), weekDates:dl,
      recommendedHours:['28.5','27.0','29.0','28.0','29.5','28.5','35.0'],
      employees:[
        { name:'Lisa Laport (M)',           totalHours:41.5, schedule:{[dl[0]]:'9 - 3:30p',[dl[1]]:'10 - 2p',[dl[2]]:'9 - 7p',[dl[3]]:'9 - 2p',[dl[4]]:null,[dl[5]]:'9 - 7p',[dl[6]]:'9 - 3p'}},
        { name:'Patricia Goodwin (M)',      totalHours:22.5, schedule:{[dl[0]]:null,[dl[1]]:'10 - 5p',[dl[2]]:'9 - 4:30p',[dl[3]]:null,[dl[4]]:'9 - 1p',[dl[5]]:null,[dl[6]]:'9 - 1p'}},
        { name:'Donna M Gannon (S)',        totalHours:41.0, schedule:{[dl[0]]:'10 - 6p',[dl[1]]:null,[dl[2]]:null,[dl[3]]:'9 - 4p',[dl[4]]:'10 - 7p',[dl[5]]:'9 - 5:30p',[dl[6]]:'9 - 5:30p'}},
        { name:'Michaela V Stachowski (S)', totalHours:44.0, schedule:{[dl[0]]:'9 - 6p',[dl[1]]:'10 - 3p',[dl[2]]:'9 - 7p',[dl[3]]:null,[dl[4]]:'9 - 7p',[dl[5]]:null,[dl[6]]:'9 - 7p'}},
        { name:'Michele Felch (S)',         totalHours:8.0,  schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:null,[dl[3]]:'3 - 7p',[dl[4]]:null,[dl[5]]:'3 - 7p',[dl[6]]:null}},
        { name:'Veronica Rivas (S)',        totalHours:7.0,  schedule:{[dl[0]]:null,[dl[1]]:'10 - 5p',[dl[2]]:null,[dl[3]]:null,[dl[4]]:null,[dl[5]]:null,[dl[6]]:null}},
      ]
    },
    {
      salonId:'3826', salonName:'Kings Crossing Publix #3826', scrapedAt:new Date().toISOString(), weekDates:dl,
      recommendedHours:['31.5','27.0','32.0','31.5','38.5','38.0','39.5'],
      employees:[
        { name:'Taylor Schwickrath (M)', totalHours:29.0, schedule:{[dl[0]]:'8 - 4p',[dl[1]]:'9 - 4p',[dl[2]]:null,[dl[3]]:null,[dl[4]]:'8 - 3p',[dl[5]]:null,[dl[6]]:'12 - 7p'}},
        { name:'Brittany Fontanez (S)', totalHours:37.0, schedule:{[dl[0]]:'8 - 4p',[dl[1]]:'9 - 5p',[dl[2]]:'8 - 3p',[dl[3]]:'8 - 3p',[dl[4]]:null,[dl[5]]:null,[dl[6]]:'8 - 3p'}},
        { name:'Carey Mosier (S)',       totalHours:22.0, schedule:{[dl[0]]:'11 - 6p',[dl[1]]:null,[dl[2]]:null,[dl[3]]:'2 - 7p',[dl[4]]:null,[dl[5]]:'2 - 7p',[dl[6]]:'2 - 7p'}},
        { name:'Christopher Dorris (S)',totalHours:22.0, schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:null,[dl[3]]:'8 - 3p',[dl[4]]:'8 - 3p',[dl[5]]:'11 - 7p',[dl[6]]:null}},
        { name:'Gail Spadafora (S)',     totalHours:32.0, schedule:{[dl[0]]:null,[dl[1]]:'9 - 5p',[dl[2]]:'11 - 7p',[dl[3]]:'11 - 7p',[dl[4]]:'11 - 7p',[dl[5]]:null,[dl[6]]:null}},
        { name:'Hope Gibbons (S)',       totalHours:6.0,  schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:null,[dl[3]]:null,[dl[4]]:'3 - 6p',[dl[5]]:'3 - 6p',[dl[6]]:null}},
        { name:'Justin Showalter (S)',   totalHours:37.0, schedule:{[dl[0]]:'10 - 6p',[dl[1]]:'9 - 5p',[dl[2]]:'8 - 3p',[dl[3]]:null,[dl[4]]:'9 - 4p',[dl[5]]:null,[dl[6]]:'12 - 7p'}},
        { name:'Kim Curry (S)',          totalHours:12.0, schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:'8 - 12p',[dl[3]]:null,[dl[4]]:'8 - 12p',[dl[5]]:null,[dl[6]]:null}},
        { name:'Maria V Rosario (S)',    totalHours:35.0, schedule:{[dl[0]]:null,[dl[1]]:'8 - 3p',[dl[2]]:'8 - 3p',[dl[3]]:'8 - 3p',[dl[4]]:'8 - 3p',[dl[5]]:'8 - 3p',[dl[6]]:null}},
      ]
    },
    {
      salonId:'4216', salonName:'North River Ranch #4216', scrapedAt:new Date().toISOString(), weekDates:dl,
      recommendedHours:['18.0','14.0','20.0','20.0','20.0','20.0','20.0'],
      employees:[
        { name:'Ingram Mcduffie (M)',   totalHours:40.0, schedule:{[dl[0]]:'1:30 - 6p',[dl[1]]:null,[dl[2]]:'9 - 12p',[dl[3]]:'9:30 - 2p',[dl[4]]:'9 - 2p',[dl[5]]:'9 - 7p',[dl[6]]:'9 - 2p'}},
        { name:'Becky Burt (S)',        totalHours:29.0, schedule:{[dl[0]]:'9 - 2p',[dl[1]]:'10 - 5p',[dl[2]]:'9 - 2p',[dl[3]]:'9 - 4p',[dl[4]]:'2 - 7p',[dl[5]]:null,[dl[6]]:null}},
        { name:'Cristy L Epps (S)',     totalHours:30.0, schedule:{[dl[0]]:'9 - 6p',[dl[1]]:'10 - 5p',[dl[2]]:'12 - 7p',[dl[3]]:null,[dl[4]]:null,[dl[5]]:null,[dl[6]]:'12 - 7p'}},
        { name:'Ricardo D Madison (S)', totalHours:22.0, schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:null,[dl[3]]:'2 - 7p',[dl[4]]:'2 - 7p',[dl[5]]:'12 - 7p',[dl[6]]:'2 - 7p'}},
        { name:'Taylor Schwickrath (S)',totalHours:5.0,  schedule:{[dl[0]]:null,[dl[1]]:null,[dl[2]]:null,[dl[3]]:null,[dl[4]]:'9 - 2p',[dl[5]]:null,[dl[6]]:null}},
      ]
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    weeks: [
      { label:'This Week', weekEnding:'2026-04-03', salons:makeSalons(days)  },
      { label:'Next Week', weekEnding:'2026-04-10', salons:makeSalons(days2) },
    ],
    knownPromotions: [
      { name:'Short Fuse',            dates:'3/24/26 – 4/10/26', price:'$12.99' },
      { name:'Collective Discounting', dates:'3/18/26 – 4/10/26', price:'$12.99' },
    ],
    specialDays:[{ name:'Easter', dates:'4/1/26 – 4/7/26' }],
  };
}

// ─── STANDALONE ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const dataPath = path.join(__dirname, 'schedule_data.json');
  let data;
  if (fs.existsSync(dataPath)) {
    data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    console.log('📂 Using existing schedule_data.json');
  } else {
    console.log('ℹ️  Using demo data');
    data = getDemoData();
  }
  generateReport(data);
}

module.exports = { generateReport, getDemoData };
