// scrape.js — Salondata Weekly Schedule Scraper
// Fetches current week + next week for all 4 salons, generates schedule_report.html

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://reports.salondata.com/static/reports/index.html';
const USERNAME = process.env.SALONDATA_USERNAME || 'gm_Jeff.Downing@greatclips.net';
const PASSWORD = process.env.SALONDATA_PASSWORD || 'PDGCofMAN2025$';

const SALONS = [
  { id: '3750', name: 'Publix At County Line Road #3750' },
  { id: '3800', name: 'Publix At Braden River #3800' },
  { id: '3826', name: 'Kings Crossing Publix #3826' },
  { id: '4216', name: 'North River Ranch #4216' },
];

function getWeekEndFriday(offsetWeeks = 0) {
  const today = new Date();
  const day   = today.getDay();
  let daysUntilFriday;
  if (day === 5)      daysUntilFriday = 0;
  else if (day === 6) daysUntilFriday = 6;
  else                daysUntilFriday = 5 - day;
  const friday = new Date(today);
  friday.setDate(today.getDate() + daysUntilFriday + offsetWeeks * 7);
  return friday;
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function scrapeSalon(page, salon, fridayStr, ssDir, weekLabel) {
  const hash = `#weeklyschedule:store=${salon.id}&start=${fridayStr}&end=${fridayStr}&current=true`;
  await page.goto(BASE_URL + hash, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(ssDir, `${weekLabel}_salon_${salon.id}.png`), fullPage: true });

  return await page.evaluate((info) => {
    const result = {
      salonId:          info.id,
      salonName:        info.name,
      weekDates:        [],
      employees:        [],
      recommendedHours: [], // per-day recommended floor hours
      promotions:       [],
      specialDays:      [],
      scrapedAt:        new Date().toISOString(),
    };

    // Grab real salon name from header rows
    for (const row of Array.from(document.querySelectorAll('tr'))) {
      const txt = (row.innerText || '').trim();
      if (txt.includes('#') && !txt.includes('Weekly Schedule') && txt.length < 80) {
        const nameLine = txt.split('\n').map(l => l.trim()).filter(Boolean).find(l => l.includes('#'));
        if (nameLine) { result.salonName = nameLine; break; }
      }
    }

    // Parse promotions & special days from the "Recommended Schedule Based On" panel.
    // Layout (per source PDF): each entry's name, date range, and (for promos) price are
    // on separate lines, e.g. "Short Fuse" / "3/24/26 -" / "4/10/26:" / "$12.99".
    const fullText = document.body.innerText || '';

    // Regex pieces for a date range that may straddle newlines, with optional trailing colon
    const DATE_RANGE = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/;
    const PRICE      = /\$\d+(?:\.\d{2})?/;

    function extractSection(text, header, stopHeaders) {
      const stops = stopHeaders.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const re = new RegExp(`${header}\\s*\\n([\\s\\S]*?)(?=\\n\\s*(?:${stops})\\b|$)`, 'i');
      const m  = text.match(re);
      return m ? m[1] : '';
    }

    // ── Special Days ─────────────────────────────────────────────────────────
    // Each entry is "<name> <m/d/yy> - <m/d/yy>" possibly wrapped across lines.
    const specialBlock = extractSection(fullText, 'Special Days', ['Promotions', 'Floor Hours', 'Last Year']);
    if (specialBlock) {
      // Collapse whitespace/newlines inside the block, then split on any date range
      const flat = specialBlock.replace(/\s+/g, ' ').trim();
      const re = new RegExp(DATE_RANGE.source, 'g');
      let lastIdx = 0, m;
      const tokens = [];
      while ((m = re.exec(flat)) !== null) {
        const namePart = flat.slice(lastIdx, m.index).trim().replace(/[:,]+$/, '');
        if (namePart) tokens.push({ name: namePart, dates: `${m[1]} - ${m[2]}` });
        lastIdx = re.lastIndex;
      }
      tokens.forEach(t => result.specialDays.push(t));
    }

    // ── Promotions ───────────────────────────────────────────────────────────
    // Each entry is "<name> <m/d/yy> - <m/d/yy>: $price" wrapped across lines.
    const promoBlock = extractSection(fullText, 'Promotions', ['Floor Hours', 'Last Year']);
    if (promoBlock) {
      const flat = promoBlock.replace(/\s+/g, ' ').trim();
      const re = new RegExp(`(${DATE_RANGE.source})\\s*:?\\s*(${PRICE.source})?`, 'g');
      let lastIdx = 0, m;
      while ((m = re.exec(flat)) !== null) {
        const namePart = flat.slice(lastIdx, m.index).trim().replace(/[:,]+$/, '');
        if (namePart) {
          result.promotions.push({
            name:  namePart,
            dates: `${m[2]} - ${m[3]}`,
            price: m[4] || '',
          });
        }
        lastIdx = re.lastIndex;
      }
    }

    // Find the schedule table (most columns)
    let scheduleTable = null, maxCols = 0;
    for (const t of Array.from(document.querySelectorAll('table'))) {
      const firstRow = t.querySelector('tr');
      if (!firstRow) continue;
      const cols = firstRow.querySelectorAll('th, td').length;
      if (cols > maxCols) { maxCols = cols; scheduleTable = t; }
    }
    if (!scheduleTable) { result.error = 'No table found'; return result; }

    const rows = Array.from(scheduleTable.querySelectorAll('tr'));
    if (!rows.length) return result;

    // Header: [Employee, Sat, Sun, Mon, Tue, Wed, Thu, Fri, Total Hours]
    const headerCells = Array.from(rows[0].querySelectorAll('th, td'))
      .map(el => (el.innerText || el.textContent || '').trim());
    result.weekDates = headerCells.slice(1, 8);

    const skipWords = [
      'projected customer','revised customer','scheduled floor',
      'scheduled non-floor','total scheduled','total flex','actual customer',
      'projected service','traffic modifier','basis','service sales',
    ];

    for (const row of rows.slice(1)) {
      const cells = Array.from(row.querySelectorAll('td, th'))
        .map(el => (el.innerText || el.textContent || '').trim());
      const name = cells[0] || '';
      if (!name) continue;

      // Capture Recommended Floor Hours row
      if (name.toLowerCase().includes('recommended floor')) {
        result.recommendedHours = cells.slice(1, 8);
        continue;
      }

      if (skipWords.some(w => name.toLowerCase().includes(w))) continue;

      // Total hours is in the last column (index 8), formatted like "37.0 Flr\n37.0 Tot"
      const totalRaw = (cells[8] || cells[cells.length - 1] || '').trim();
      // Extract first number — floor hours
      const totalMatch = totalRaw.match(/(\d+\.?\d*)/);
      const totalHours = totalMatch ? parseFloat(totalMatch[1]) : null;

      const schedule = {};
      result.weekDates.forEach((day, idx) => {
        const raw = (cells[idx + 1] || '').trim();
        schedule[day] = (raw && raw !== 'OFF' && raw !== 'X') ? raw : null;
      });

      result.employees.push({ name, schedule, totalHours });
    }

    return result;
  }, salon);
}

async function scrapeSchedule() {
  const thisWeekFriday = getWeekEndFriday(0);
  const nextWeekFriday = getWeekEndFriday(1);
  const thisWeekStr    = formatDate(thisWeekFriday);
  const nextWeekStr    = formatDate(nextWeekFriday);

  console.log(`\n🗓  This week: ${thisWeekStr}  |  Next week: ${nextWeekStr}`);
  console.log('🚀 Launching browser...\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page    = await context.newPage();
  const ssDir   = path.join(__dirname, 'screenshots');
  if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir);

  const weeksData = [
    { label: 'This Week', fridayStr: thisWeekStr, salons: [] },
    { label: 'Next Week', fridayStr: nextWeekStr, salons: [] },
  ];

  try {
    // Login
    console.log('🔐 Opening Salondata...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2500);

    const emailField = await page.$('input[type="email"]');
    if (emailField) {
      console.log('  📝 Logging in...');
      await page.fill('input[type="email"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      const submitted = await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"], input[type="submit"], button.login, button.signin');
        if (btn) { btn.click(); return true; }
        const allButtons = Array.from(document.querySelectorAll('button'));
        const textBtn = allButtons.find(b => /log|sign/i.test(b.innerText));
        if (textBtn) { textBtn.click(); return true; }
        return false;
      });
      if (!submitted) await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);
      console.log('  ✅ Logged in.\n');
    }

    // Scrape both weeks
    for (const week of weeksData) {
      console.log(`\n📅 === ${week.label} (${week.fridayStr}) ===`);
      for (const salon of SALONS) {
        console.log(`  📍 ${salon.name}`);
        const data = await scrapeSalon(page, salon, week.fridayStr, ssDir, week.label.replace(' ','_').toLowerCase());
        console.log(`     👥 ${data.employees.length} stylists  |  Rec. hours: [${(data.recommendedHours||[]).join(', ')}]`);
        if (data.error) console.log(`     ⚠️  ${data.error}`);
        week.salons.push(data);
      }
    }

  } catch (err) {
    console.error('\n❌ Scraper error:', err.message);
  } finally {
    await browser.close();
  }

  // Aggregate promotions/special days from per-salon scrape (deduped by name+dates).
  // The same panel appears on every salon page; we only need a unique union.
  const seenPromos = new Set();
  const knownPromotions = [];
  const seenSpecial = new Set();
  const specialDays = [];
  for (const week of weeksData) {
    for (const salon of week.salons) {
      for (const p of salon.promotions || []) {
        if (!p || !p.name) continue;
        const key = `${p.name}|${p.dates}`;
        if (seenPromos.has(key)) continue;
        seenPromos.add(key);
        knownPromotions.push(p);
      }
      for (const s of salon.specialDays || []) {
        if (!s || !s.name) continue;
        const key = `${s.name}|${s.dates}`;
        if (seenSpecial.has(key)) continue;
        seenSpecial.add(key);
        specialDays.push(s);
      }
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    weeks: weeksData,
    knownPromotions,
    specialDays,
  };

  fs.writeFileSync(path.join(__dirname, 'schedule_data.json'), JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved → schedule_data.json`);

  const { generateReport } = require('./generate-report.js');
  generateReport(output);

  // Rename generated file to index.html for GitHub Pages
  const reportPath = path.join(__dirname, 'schedule_report.html');
  const indexPath  = path.join(__dirname, 'index.html');
  fs.copyFileSync(reportPath, indexPath);
  console.log('📄 Copied → index.html');

  // ── Auto-push to GitHub ──────────────────────────────────────────────────
  console.log('\n🚀 Pushing to GitHub...');
  const { execSync } = require('child_process');
  const run = (cmd) => execSync(cmd, { cwd: __dirname, stdio: 'inherit' });

  try {
    run('git add index.html');
    try {
      run('git commit -m "Auto-update schedule"');
    } catch {
      console.log('ℹ️  No index.html changes to commit.');
    }
    try {
      run('git push origin main');
    } catch {
      console.log('⚠️  Push rejected — attempting rebase on origin/main and retrying...');
      run('git fetch origin main');
      run('git rebase -X theirs origin/main');
      run('git push origin main');
    }
    console.log('✅ GitHub updated! Live at: https://jmd0515.github.io/Salon-Schedule\n');
  } catch (err) {
    console.error('❌ Git push FAILED:', err.message);
    process.exitCode = 1;
  }
}

scrapeSchedule().catch(err => { console.error('Fatal:', err); process.exit(1); });
