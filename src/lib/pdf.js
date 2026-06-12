import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateLong, fmtDate } from './week.js'

// ── palette ───────────────────────────────────────────────────────────────────
const INK      = [15, 20, 18]
const GRAPHITE = [60, 75, 70]
const MIST     = [130, 148, 142]
const FAINT    = [180, 192, 187]
const HAIR     = [225, 232, 229]
const PAPER    = [250, 252, 251]
const WHITE    = [255, 255, 255]
const JADE     = [13, 124, 92]
const JADE_D   = [8, 80, 59]
const JADE_W   = [225, 245, 238]
const CLAY     = [194, 79, 46]
const CLAY_D   = [158, 58, 31]
const CLAY_W   = [250, 232, 227]
const AMBER    = [186, 117, 23]
const AMBER_W  = [250, 238, 218]
const BLUE     = [24, 95, 165]
const BLUE_W   = [230, 241, 251]
const PURPLE   = [83, 74, 183]
const PURPLE_W = [238, 237, 254]
const DARK     = [10, 26, 20]

function clean(s) {
  if (s == null) return ''
  return String(s).replace(/[^\x00-\xFF]/g, '?')
}
function n(v, d = 1) {
  if (v == null || isNaN(v)) return '—'
  return Number(v).toFixed(d)
}
function ageFrom(dob) {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 864e5))
}
function ladderFor(drug) {
  const s = (drug || '').toLowerCase()
  if (s.includes('tirzep') || s.includes('mounjaro')) return { name: 'Tirzepatide', steps: [2.5, 5, 7.5, 10, 12.5, 15] }
  if (s.includes('semaglu') || s.includes('ozempic') || s.includes('wegovy')) return { name: 'Semaglutide', steps: [0.25, 0.5, 1, 1.7, 2.4] }
  if (s.includes('lira') || s.includes('saxenda')) return { name: 'Liraglutide', steps: [0.6, 1.2, 1.8, 2.4, 3.0] }
  return { name: clean(drug) || 'GLP-1', steps: [] }
}

function calcScore(data, profile) {
  let score = 0, total = 0
  const add = (pts, max) => { score += Math.min(pts, max); total += max }
  const weights = data.weights || []
  const lastW = weights.length ? Number(weights[weights.length - 1].weight_kg) : null
  const baseW = profile?.baseline_weight_kg ? Number(profile.baseline_weight_kg) : null
  if (lastW && baseW && lastW < baseW) add(15, 15); else add(0, 15)
  const sideFx = (data.symptoms || []).filter(s => s.type !== 'craving')
  const peakSev = sideFx.reduce((m, s) => Math.max(m, Number(s.severity) || 0), 0)
  add(peakSev <= 1 ? 15 : peakSev <= 2 ? 10 : peakSev <= 3 ? 5 : 0, 15)
  const cravings = (data.symptoms || []).filter(s => s.type === 'craving')
  const avgCrav = cravings.length ? cravings.reduce((a, c) => a + (Number(c.severity) || 0), 0) / cravings.length : null
  add(avgCrav == null ? 10 : avgCrav <= 1 ? 15 : avgCrav <= 2 ? 12 : avgCrav <= 3 ? 8 : 4, 15)
  const totalProt = (data.meals || []).reduce((s, m) => s + (Number(m.protein_g) || 0), 0)
  const protPerKg = lastW && totalProt ? totalProt / 7 / lastW : null
  add(protPerKg == null ? 5 : protPerKg >= 1.2 ? 15 : protPerKg >= 0.8 ? 8 : 3, 15)
  const totalMin = (data.activities || []).reduce((s, a) => s + (Number(a.duration_min) || 0), 0)
  add(totalMin >= 150 ? 15 : totalMin >= 60 ? 10 : totalMin >= 30 ? 6 : 0, 15)
  const avgSleep = (data.sleep || []).length ? (data.sleep || []).reduce((s, sl) => s + (Number(sl.hours) || 0), 0) / data.sleep.length : null
  add(avgSleep == null ? 5 : avgSleep >= 7 && avgSleep <= 9 ? 10 : avgSleep >= 6 ? 7 : 3, 10)
  const avgMood = (data.mood || []).length ? (data.mood || []).reduce((s, m) => s + (Number(m.score) || 0), 0) / data.mood.length : null
  add(avgMood == null ? 5 : avgMood >= 3 ? 10 : avgMood >= 2 ? 6 : 3, 10)
  add((data.injections || []).length > 0 ? 5 : 0, 5)
  return total ? Math.round((score / total) * 100) : 0
}

export function buildReportDoc({ profile, appointment, window, data }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 36
  const CW = PW - M * 2
  let y = 0

  // ── derived data ──────────────────────────────────────────────────────────
  const weights = [...(data.weights || [])].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const lastW = weights.length ? Number(weights[weights.length - 1].weight_kg) : null
  const baseW = profile?.baseline_weight_kg ? Number(profile.baseline_weight_kg) : null
  const goalW = profile?.height_cm ? 24.9 * Math.pow(Number(profile.height_cm) / 100, 2) : null
  const lostTotal = baseW && lastW ? baseW - lastW : null
  const journeyPct = baseW && goalW && lastW ? Math.max(0, Math.min(1, (baseW - lastW) / (baseW - goalW))) : null
  const cycleStartW = data.prevWeight ?? (weights[0]?.weight_kg ? Number(weights[0].weight_kg) : null)
  const deltaW = lastW && cycleStartW ? lastW - cycleStartW : null
  const bmi = lastW && profile?.height_cm ? lastW / Math.pow(Number(profile.height_cm) / 100, 2) : null

  const inj = [...(data.injections || [])].sort((a, b) => new Date(a.injected_at) - new Date(b.injected_at))
  const lastInj = inj.length ? inj[inj.length - 1] : null
  const lastDose = lastInj?.dose_mg ? Number(lastInj.dose_mg) : null
  const lastDrug = lastInj?.drug || profile?.glp1_drug || ''
  const ladder = ladderFor(lastDrug)
  const curRung = lastDose != null ? ladder.steps.findIndex(s => Math.abs(s - lastDose) < 1e-6) : -1
  const nextDose = curRung >= 0 && curRung < ladder.steps.length - 1 ? ladder.steps[curRung + 1] : null

  const sideFx = (data.symptoms || []).filter(s => (s.type || '').toLowerCase() !== 'craving')
  const cravings = (data.symptoms || []).filter(s => (s.type || '').toLowerCase() === 'craving')
  const peakSev = sideFx.reduce((m, s) => Math.max(m, Number(s.severity) || 0), 0)
  const giClear = peakSev <= 2
  const avgCraving = cravings.length ? cravings.reduce((a, c) => a + (Number(c.severity) || 0), 0) / cravings.length : null
  const cravingTrend = (() => {
    if (cravings.length < 2) return null
    const sorted = [...cravings].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
    const mid = Math.floor(sorted.length / 2)
    const avg = arr => arr.reduce((s, c) => s + (Number(c.severity) || 0), 0) / arr.length
    return avg(sorted.slice(mid)) - avg(sorted.slice(0, mid))
  })()

  const meals = data.meals || []
  const totalProt = meals.reduce((s, m) => s + (Number(m.protein_g) || 0), 0)
  const totalCal = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0)
  const protPerKg = lastW && totalProt ? totalProt / 7 / lastW : null
  const totalWater = (data.water || []).reduce((s, w) => s + (Number(w.amount_ml) || 0), 0)
  const avgWater = totalWater / 7 / 1000
  const acts = data.activities || []
  const totalMin = acts.reduce((s, a) => s + (Number(a.duration_min) || 0), 0)
  const resistMin = acts.filter(a => /strength|weight|resist|barbell/i.test(a.type || '')).reduce((s, a) => s + (Number(a.duration_min) || 0), 0)
  const avgSleep = (data.sleep || []).length ? (data.sleep || []).reduce((s, sl) => s + (Number(sl.hours) || 0), 0) / data.sleep.length : null
  const avgMood = (data.mood || []).length ? (data.mood || []).reduce((s, m) => s + (Number(m.score) || 0), 0) / data.mood.length : null

  const treatStart = profile?.treatment_start_date ? new Date(profile.treatment_start_date) : null
  const weekNum = treatStart ? Math.ceil((new Date() - treatStart) / (7 * 24 * 60 * 60 * 1000)) : null
  const score = calcScore(data, profile)

  // ── grade helper ──────────────────────────────────────────────────────────
  function grade(val, good, warn) {
    if (val == null) return { g: '—', c: MIST }
    if (val >= good) return { g: 'A', c: JADE }
    if (val >= warn) return { g: 'B', c: AMBER }
    return { g: 'C', c: CLAY }
  }
  function gradeRev(val, bad, worse) { // lower is better
    if (val == null) return { g: '—', c: MIST }
    if (val <= bad) return { g: 'A', c: JADE }
    if (val <= worse) return { g: 'B', c: AMBER }
    return { g: 'C', c: CLAY }
  }

  // ── drawing helpers ───────────────────────────────────────────────────────
  function bar(x, ty, w, h, pct, fg, bg = HAIR) {
    doc.setFillColor(...bg); doc.roundedRect(x, ty, w, h, h / 2, h / 2, 'F')
    if (pct > 0) { doc.setFillColor(...fg); doc.roundedRect(x, ty, Math.max(h, w * Math.min(1, pct)), h, h / 2, h / 2, 'F') }
  }
  function gradeCircle(x, ty, r, g, color) {
    doc.setFillColor(...(g === 'A' ? JADE_W : g === 'B' ? AMBER_W : g === 'C' ? CLAY_W : HAIR))
    doc.circle(x, ty, r, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...color)
    doc.text(g, x, ty + 3.5, { align: 'center' })
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  PAGE 1 — MASTHEAD + SCORE + SCORECARD
  // ═════════════════════════════════════════════════════════════════════════

  // dark header band
  doc.setFillColor(...DARK)
  doc.rect(0, 0, PW, 88, 'F')

  // patient name
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...WHITE)
  doc.text(clean(profile?.full_name) || 'Patient', M, 34)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(180, 200, 193)
  const meta = [
    clean(profile?.full_name ? '' : ''),
    clean(lastDrug) || 'GLP-1',
    weekNum ? `Week ${weekNum} of treatment` : '',
    `${fmtDate(window.start)} – ${fmtDate(window.end)}`,
  ].filter(Boolean).join('  ·  ')
  doc.text(meta, M, 48)

  // health score circle
  const cx = PW - M - 36, cy = 44, cr = 28
  doc.setFillColor(...JADE); doc.circle(cx, cy, cr, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...WHITE)
  doc.text(String(score), cx, cy + 6, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(180, 230, 210)
  doc.text('HEALTH SCORE', cx, cy + 18, { align: 'center' })

  // appointment info
  const ax = PW - M - 80
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(150, 180, 170)
  doc.text('NEXT APPOINTMENT', ax, 32, { align: 'right' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...WHITE)
  doc.text(fmtDateLong(appointment.appointment_date), ax, 44, { align: 'right' })
  if (appointment.clinician) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(150, 180, 170)
    doc.text(clean(appointment.clinician), ax, 56, { align: 'right' })
  }

  // week badge
  if (weekNum) {
    doc.setFillColor(...JADE); doc.roundedRect(M, 58, 56, 16, 8, 8, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...WHITE)
    doc.text(`Week ${weekNum}`, M + 28, 69, { align: 'center' })
  }

  y = 104

  // ── 6-stat KPI band ───────────────────────────────────────────────────────
  const kpis = [
    { l: 'Weight', v: lastW ? `${n(lastW, 1)}` : '—', u: 'kg', sub: deltaW != null ? `${deltaW <= 0 ? '▼' : '▲'} ${Math.abs(deltaW).toFixed(1)} kg` : '', c: deltaW != null && deltaW <= 0 ? JADE : CLAY },
    { l: 'Total lost', v: lostTotal != null ? `${lostTotal.toFixed(1)}` : '—', u: 'kg', sub: journeyPct != null ? `${(journeyPct * 100).toFixed(0)}% to goal` : '', c: JADE },
    { l: 'Dose', v: lastDose ? String(lastDose) : '—', u: 'mg', sub: curRung >= 0 ? `Step ${curRung + 1}/${ladder.steps.length}` : '', c: INK },
    { l: 'GI events', v: String(sideFx.length), u: '', sub: giClear ? 'Escalation ready' : `Peak ${peakSev}/5`, c: giClear ? JADE : CLAY },
    { l: 'Craving avg', v: avgCraving != null ? avgCraving.toFixed(1) : '—', u: '/5', sub: cravingTrend != null ? (cravingTrend <= 0 ? 'Easing' : 'Rising ▲') : '', c: avgCraving != null && avgCraving > 2 ? AMBER : JADE },
    { l: 'Sleep avg', v: avgSleep != null ? avgSleep.toFixed(1) : '—', u: 'hrs', sub: 'per night', c: avgSleep != null && avgSleep >= 7 ? JADE : AMBER },
  ]
  const kW = CW / 6
  doc.setFillColor(...[8, 45, 32])
  doc.roundedRect(M, y, CW, 52, 6, 6, 'F')
  kpis.forEach((k, i) => {
    const kx = M + i * kW + kW / 2
    if (i > 0) { doc.setDrawColor(255, 255, 255, 0.1); doc.setLineWidth(0.4); doc.line(M + i * kW, y + 10, M + i * kW, y + 42) }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...k.c)
    doc.text(k.v, kx, y + 26, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(150, 185, 172)
    doc.text(k.l.toUpperCase(), kx, y + 13, { align: 'center' })
    if (k.sub) { doc.setFontSize(6.8); doc.setTextColor(120, 160, 148); doc.text(k.sub, kx, y + 37, { align: 'center' }) }
  })
  y += 64

  // ── journey bars ──────────────────────────────────────────────────────────
  if (journeyPct != null || ladder.steps.length > 0) {
    const jH = ladder.steps.length > 0 ? 60 : 32
    doc.setFillColor(...PAPER); doc.setDrawColor(...HAIR); doc.setLineWidth(0.5)
    doc.roundedRect(M, y, CW, jH, 5, 5, 'FD')
    let jy = y + 16
    if (journeyPct != null) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
      doc.text('WEIGHT GOAL', M + 12, jy - 4)
      bar(M + 90, jy - 8, CW - 140, 7, journeyPct, JADE)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...JADE_D)
      doc.text(`${(journeyPct * 100).toFixed(0)}%`, PW - M - 8, jy - 3, { align: 'right' })
    }
    if (ladder.steps.length > 0) {
      jy = y + 42
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
      doc.text('DOSE LADDER', M + 12, jy - 4)
      const lx = M + 90, lw = CW - 140, lg = lw / (ladder.steps.length - 1 || 1)
      doc.setDrawColor(...HAIR); doc.setLineWidth(2); doc.line(lx, jy - 3.5, lx + lw, jy - 3.5)
      if (curRung > 0) { doc.setDrawColor(...JADE); doc.setLineWidth(2.5); doc.line(lx, jy - 3.5, lx + lg * curRung, jy - 3.5) }
      ladder.steps.forEach((s, i) => {
        const px = ladder.steps.length === 1 ? lx + lw / 2 : lx + lg * i
        const done = i <= curRung && curRung >= 0, cur = i === curRung
        doc.setFillColor(...(cur ? JADE_D : done ? JADE : HAIR)); doc.setDrawColor(...(done || cur ? JADE : HAIR))
        doc.setLineWidth(1); doc.circle(px, jy - 3.5, cur ? 5 : 3.5, 'FD')
        if (cur) { doc.setFillColor(...WHITE); doc.circle(px, jy - 3.5, 1.8, 'F') }
        doc.setFont('helvetica', cur ? 'bold' : 'normal'); doc.setFontSize(cur ? 8 : 7)
        doc.setTextColor(...(cur ? JADE_D : done ? JADE : MIST))
        doc.text(`${s}`, px, jy + 8, { align: 'center' })
      })
    }
    y += jH + 10
  }

  // ── SCORECARD ─────────────────────────────────────────────────────────────
  const scLabel = (txt) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
    doc.text(txt, M, y + 5)
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.4)
    doc.line(M + doc.getTextWidth(txt) + 4, y + 2, PW - M, y + 2)
    y += 12
  }

  const COL = { param: M, bar: M + 158, val: M + 338, grade: M + 418, trend: M + 458 }
  const ROW_H = 26

  // column headers
  doc.setFillColor(...PAPER); doc.rect(M, y, CW, 14, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
  ;['Parameter', 'Progress vs target', 'This week', 'Grade', 'Trend / note'].forEach((h, i) => {
    const xs = [COL.param, COL.bar, COL.val, COL.grade, COL.trend]
    doc.text(h, xs[i], y + 10)
  })
  y += 16

  function scRow(icon, name, sub, barVal, barMax, valStr, valSub, gradeObj, note, rowBg) {
    if (y > PH - 80) { doc.addPage(); y = 40 }
    doc.setFillColor(...(rowBg || WHITE)); doc.rect(M, y, CW, ROW_H, 'F')
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.3); doc.line(M, y + ROW_H, M + CW, y + ROW_H)

    // left accent
    doc.setFillColor(...(gradeObj.g === 'A' ? JADE : gradeObj.g === 'B' ? AMBER : gradeObj.g === 'C' ? CLAY : HAIR))
    doc.rect(M, y, 3, ROW_H, 'F')

    // param name
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
    doc.text(name, COL.param + 8, y + 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MIST)
    doc.text(sub, COL.param + 8, y + 21)

    // bar
    const bw = 170
    bar(COL.bar, y + 9, bw, 6,
      barVal != null && barMax ? barVal / barMax : 0,
      gradeObj.g === 'A' ? JADE : gradeObj.g === 'B' ? AMBER : CLAY)
    if (barVal != null && barMax) {
      const pct = Math.min(1, barVal / barMax)
      doc.setFillColor(...WHITE); doc.setDrawColor(...(gradeObj.g === 'A' ? JADE_D : gradeObj.g === 'B' ? AMBER : CLAY_D))
      doc.setLineWidth(1); doc.circle(COL.bar + bw * pct, y + 12, 4, 'FD')
    }

    // value
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
    doc.setTextColor(...(gradeObj.g === 'A' ? JADE_D : gradeObj.g === 'B' ? [133, 79, 11] : gradeObj.g === 'C' ? CLAY_D : INK))
    doc.text(valStr, COL.val, y + 13)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MIST)
    if (valSub) doc.text(valSub, COL.val, y + 22)

    // grade circle
    gradeCircle(COL.grade + 10, y + 13, 9, gradeObj.g, gradeObj.g === 'A' ? JADE_D : gradeObj.g === 'B' ? [133, 79, 11] : CLAY_D)

    // note
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRAPHITE)
    doc.text(clean(note), COL.trend, y + 14, { maxWidth: PW - M - COL.trend - 4 })

    y += ROW_H
  }

  // BODY
  scLabel('BODY')
  scRow('', 'Weight', `Baseline ${baseW ? baseW.toFixed(1) : '—'} · Goal ${goalW ? goalW.toFixed(1) : '—'} kg`,
    lostTotal, baseW && goalW ? baseW - goalW : null,
    lastW ? `${n(lastW, 1)} kg` : '—', deltaW != null ? `${deltaW <= 0 ? '▼' : '▲'} ${Math.abs(deltaW).toFixed(1)} kg` : '',
    grade(lostTotal, 1, 0), deltaW != null && deltaW <= 0 ? 'On track' : 'Gaining', PAPER)
  scRow('', 'Rate of loss', 'Target -0.5 to -1.0 kg/week',
    deltaW != null ? Math.abs(deltaW) : null, 1.0,
    deltaW != null ? `${Math.abs(deltaW).toFixed(1)} kg/wk` : '—', '',
    grade(deltaW != null ? Math.abs(deltaW) : null, 0.5, 0.2), 'Target: 0.5–1.0/wk', WHITE)

  // MEDICATION
  scLabel('MEDICATION')
  scRow('', 'Weekly injection', `${clean(lastDrug) || 'GLP-1'} · ${curRung >= 0 ? `Step ${curRung + 1}/${ladder.steps.length}` : 'Step unknown'}`,
    inj.length > 0 ? 1 : 0, 1,
    lastDose ? `${lastDose} mg` : '—', lastInj ? fmtDate(lastInj.injected_at) : 'Not logged',
    grade(inj.length, 1, 1), nextDose ? `Next: ${nextDose} mg` : 'At maintenance', PAPER)

  // TOLERABILITY
  scLabel('TOLERABILITY')
  scRow('', 'GI side effects', 'Gate for dose escalation',
    giClear ? 1 : 0, 1,
    String(sideFx.length), peakSev > 0 ? `Peak ${peakSev}/5` : 'None',
    grade(giClear ? 1 : 0, 1, 1), giClear ? 'Ready to escalate' : 'Hold dose', PAPER)
  scRow('', 'Food noise / craving', 'GLP-1 efficacy signal — lower is better',
    avgCraving != null ? Math.max(0, 5 - avgCraving) : null, 5,
    avgCraving != null ? `${avgCraving.toFixed(1)}/5` : '—', cravingTrend != null ? (cravingTrend <= 0 ? 'Easing' : 'Rising ▲') : '',
    gradeRev(avgCraving, 2, 3), avgCraving != null && avgCraving > 3 ? 'Appetite suppression weak' : '', WHITE)

  // NUTRITION
  scLabel('NUTRITION')
  scRow('', 'Protein intake', 'Target ≥ 1.2 g/kg/day — lean mass protection',
    protPerKg, 1.6,
    protPerKg != null ? `${protPerKg.toFixed(2)} g/kg` : '—', 'per day',
    grade(protPerKg, 1.2, 0.8), protPerKg != null && protPerKg < 1.2 ? 'Below minimum — muscle risk' : 'Good', PAPER)
  scRow('', 'Hydration', 'Target ≥ 2.5 L/day',
    avgWater, 2.5,
    totalWater > 0 ? `${avgWater.toFixed(1)} L` : '—', 'per day avg',
    grade(totalWater > 0 ? avgWater : null, 2.5, 1.5), avgWater < 2.5 ? 'Increase intake' : 'On target', WHITE)

  // ACTIVITY
  scLabel('ACTIVITY')
  scRow('', 'Cardio', 'Target ≥ 150 min/week',
    totalMin, 150,
    `${totalMin} min`, `${acts.length} session${acts.length !== 1 ? 's' : ''}`,
    grade(totalMin, 150, 60), totalMin < 150 ? `${150 - totalMin} min short` : 'Target met', PAPER)
  scRow('', 'Resistance training', 'Target ≥ 2 sessions/week — critical on GLP-1',
    resistMin, 60,
    resistMin > 0 ? `${resistMin} min` : 'None', resistMin > 0 ? 'Logged' : 'Not logged',
    grade(resistMin, 60, 20), resistMin === 0 ? 'Muscle loss risk — advise programme' : 'Good', WHITE)

  // WELLBEING
  scLabel('WELLBEING')
  scRow('', 'Sleep', 'Target 7–9 hours per night',
    avgSleep, 9,
    avgSleep != null ? `${avgSleep.toFixed(1)} hrs` : '—', 'avg per night',
    grade(avgSleep, 7, 6), avgSleep != null && (avgSleep < 7 || avgSleep > 9) ? 'Outside target range' : 'Good', PAPER)
  scRow('', 'Energy & mood', 'Daily self-report 1–5',
    avgMood, 5,
    avgMood != null ? `${avgMood.toFixed(1)}/5` : '—', avgMood != null ? ['', 'Low', 'Okay', 'Good', 'Great', 'Best'][Math.round(avgMood)] : '',
    grade(avgMood, 3, 2), avgMood != null && avgMood < 3 ? 'Low mood — discuss' : 'Stable', WHITE)

  y += 10

  // ── day-by-day strip ──────────────────────────────────────────────────────
  if (y > PH - 120) { doc.addPage(); y = 40 }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
  doc.text('DAY BY DAY', M, y + 5)
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.4)
  doc.line(M + doc.getTextWidth('DAY BY DAY') + 4, y + 2, PW - M, y + 2)
  y += 12

  const dW = CW / 7
  ;[0,1,2,3,4,5,6].forEach(i => {
    const day = new Date(window.start)
    day.setDate(day.getDate() + i + 1)
    const dayStr = day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
    const apptDay = day.toDateString() === new Date(appointment.appointment_date + 'T12:00:00').toDateString()
    const dx = M + i * dW

    doc.setFillColor(...(apptDay ? CLAY : PAPER)); doc.setDrawColor(...HAIR); doc.setLineWidth(0.4)
    doc.roundedRect(dx + 1, y, dW - 2, 18, 3, 3, apptDay ? 'F' : 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.setTextColor(...(apptDay ? WHITE : INK))
    doc.text(dayStr, dx + dW / 2, y + 12, { align: 'center' })
  })
  y += 20

  const DOT_TYPES = [
    { arr: data.injections, tf: 'injected_at', col: CLAY, label: 'Inj' },
    { arr: data.weights, tf: 'logged_at', col: JADE, label: 'Wt' },
    { arr: (data.symptoms||[]).filter(s=>s.type==='craving'), tf: 'occurred_at', col: PURPLE, label: 'Crav' },
    { arr: (data.symptoms||[]).filter(s=>s.type!=='craving'), tf: 'occurred_at', col: AMBER, label: 'Side' },
    { arr: data.activities, tf: 'started_at', col: BLUE, label: 'Act' },
    { arr: data.sleep||[], tf: 'logged_at', col: [83,74,183], label: 'Sleep' },
  ]

  DOT_TYPES.forEach(dt => {
    ;[0,1,2,3,4,5,6].forEach(i => {
      const day = new Date(window.start)
      day.setDate(day.getDate() + i + 1)
      const has = (dt.arr || []).some(r => {
        const d = new Date(r[dt.tf])
        return d.getDate() === day.getDate() && d.getMonth() === day.getMonth()
      })
      if (has) {
        const dx = M + i * dW + dW / 2
        doc.setFillColor(...dt.col); doc.circle(dx, y + 4, 3, 'F')
      }
    })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MIST)
    doc.text(dt.label, M - 2, y + 7, { align: 'right' })
    y += 10
  })
  y += 6

  // ── action items + green lights ───────────────────────────────────────────
  if (y > PH - 140) { doc.addPage(); y = 40 }

  const actions = []
  if (avgCraving != null && avgCraving > 3) actions.push(`Craving ${avgCraving.toFixed(1)}/5 avg — appetite suppression may be weakening. Review dose adequacy.`)
  if (cravingTrend != null && cravingTrend > 0.5) actions.push(`Craving rising trend this cycle. Was lower last week — discuss with patient.`)
  if (protPerKg != null && protPerKg < 1.2) actions.push(`Protein ${protPerKg.toFixed(2)} g/kg/day — below 1.2 minimum. Lean mass loss risk on GLP-1. Set protein targets.`)
  if (totalWater > 0 && avgWater < 1.5) actions.push(`Hydration critically low at ${avgWater.toFixed(1)} L/day. Advise 2.5+ L minimum.`)
  if (resistMin === 0) actions.push(`No resistance training logged. Muscle loss accelerates on GLP-1 without it. Recommend supervised programme.`)
  if (totalMin < 60) actions.push(`Very low activity — only ${totalMin} min logged. Target is 150 min/week.`)
  if (!giClear) actions.push(`GI events present (peak severity ${peakSev}/5). Hold dose escalation until resolved.`)
  if (avgMood != null && avgMood < 2.5) actions.push(`Low mood score ${avgMood.toFixed(1)}/5 — discuss wellbeing and GLP-1 effects on energy.`)

  const greens = []
  if (giClear) greens.push(`GI clear (${sideFx.length} events, peak ${peakSev}/5) — dose escalation approved.${nextDose ? ` Next: ${nextDose} mg.` : ''}`)
  if (lostTotal != null && lostTotal > 0) greens.push(`Weight down ${lostTotal.toFixed(1)} kg from baseline — ${journeyPct != null ? (journeyPct * 100).toFixed(0) + '% to goal.' : 'progressing.'}`)
  if (inj.length > 0) greens.push(`Injection taken this cycle — adherence confirmed.`)
  if (avgSleep != null && avgSleep >= 7 && avgSleep <= 9) greens.push(`Sleep ${avgSleep.toFixed(1)} hrs/night — within healthy 7–9 hr range.`)
  if (avgMood != null && avgMood >= 3) greens.push(`Mood ${avgMood.toFixed(1)}/5 — stable and positive.`)

  const boxH = Math.max(actions.length, greens.length) * 18 + 28
  const halfW = (CW - 10) / 2

  // red box
  doc.setFillColor(...CLAY_W); doc.setDrawColor(...[240, 153, 123]); doc.setLineWidth(0.6)
  doc.roundedRect(M, y, halfW, boxH, 5, 5, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...CLAY_D)
  doc.text('ACTION ITEMS FOR THIS VISIT', M + 10, y + 14)
  actions.forEach((a, i) => {
    const ty = y + 26 + i * 18
    doc.setFillColor(...CLAY); doc.circle(M + 14, ty - 2, 5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...WHITE)
    doc.text(String(i + 1), M + 14, ty + 1.5, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(...CLAY_D)
    doc.text(clean(a), M + 24, ty + 1, { maxWidth: halfW - 28 })
  })
  if (actions.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MIST)
    doc.text('No urgent action items this cycle.', M + 10, y + 32)
  }

  // green box
  const gx = M + halfW + 10
  doc.setFillColor(...JADE_W); doc.setDrawColor(...[159, 225, 203]); doc.setLineWidth(0.6)
  doc.roundedRect(gx, y, halfW, boxH, 5, 5, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...JADE_D)
  doc.text('CONFIRMED THIS VISIT', gx + 10, y + 14)
  greens.forEach((g, i) => {
    const ty = y + 26 + i * 18
    doc.setFillColor(...JADE); doc.circle(gx + 14, ty - 2, 5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...WHITE)
    doc.text('✓', gx + 14, ty + 2, { align: 'center' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(...JADE_D)
    doc.text(clean(g), gx + 24, ty + 1, { maxWidth: halfW - 28 })
  })

  y += boxH + 10

  // ── PAGE 2: detailed tables ───────────────────────────────────────────────
  doc.addPage(); y = 40

  const tBase = (accentColor) => ({
    startY: y, margin: { left: M, right: M }, theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 5, right: 7, bottom: 5, left: 7 }, textColor: INK, lineWidth: 0, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: accentColor, textColor: WHITE, fontSize: 7.5, fontStyle: 'bold', cellPadding: { top: 6, right: 7, bottom: 6, left: 7 } },
    bodyStyles: { fillColor: WHITE }, alternateRowStyles: { fillColor: PAPER },
    footStyles: { fillColor: JADE_W, textColor: JADE_D, fontStyle: 'bold', fontSize: 7.5 },
  })
  function tRun(opts) { autoTable(doc, opts); y = doc.lastAutoTable.finalY + 14 }
  const empty = (c) => [[{ content: 'No entries this cycle', colSpan: c, styles: { textColor: MIST, fontStyle: 'italic', halign: 'center' } }]]
  const fmtT = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  function secHead(txt, color = JADE_D) {
    if (y > PH - 100) { doc.addPage(); y = 40 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...color)
    doc.text(txt.toUpperCase(), M, y)
    y += 5; doc.setDrawColor(...color); doc.setLineWidth(1.5); doc.line(M, y, M + 20, y)
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.4); doc.line(M + 24, y, PW - M, y)
    y += 10
  }

  secHead('Injection history', CLAY_D)
  tRun({ ...tBase(CLAY), head: [['When', 'Drug', 'Dose (mg)', 'Site', 'Lot', 'Notes']],
    body: inj.length ? inj.map(i => [fmtT(i.injected_at), clean(i.drug)||'—', n(i.dose_mg,2), clean(i.site)||'—', clean(i.lot)||'—', clean(i.notes)])
      : empty(6), columnStyles: { 0: { cellWidth: 110 }, 2: { halign: 'right' } } })

  secHead('Tolerability & GI side effects', CLAY_D)
  tRun({ ...tBase(CLAY), head: [['When', 'Symptom', 'Severity /5', 'Notes']],
    body: sideFx.length ? sideFx.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at))
      .map(s=>[fmtT(s.occurred_at),clean(s.type)||'—',`${s.severity||'—'}/5`,clean(s.notes)])
      : empty(4), columnStyles: { 0: { cellWidth: 110 } } })

  secHead('Food noise & cravings', [100, 50, 160])
  tRun({ ...tBase(PURPLE), head: [['When', 'Intensity /5', 'Notes']],
    body: cravings.length ? cravings.sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at))
      .map(c=>[fmtT(c.occurred_at),`${c.severity||'—'}/5`,clean(c.notes)])
      : empty(3), columnStyles: { 0: { cellWidth: 110 } } })

  secHead('Weight log')
  let prevWv = data.prevWeight ?? null
  tRun({ ...tBase(JADE), head: [['When', 'Weight (kg)', 'Change (kg)', 'Source']],
    body: weights.length ? weights.map(w=>{
      const val=Number(w.weight_kg), d=prevWv!=null?val-prevWv:null; prevWv=val
      return [fmtT(w.logged_at), n(val,1), d!=null?`${d>0?'+':''}${d.toFixed(1)}`:'—', clean(w.source)||'manual']
    }) : empty(4), columnStyles: { 0:{cellWidth:110}, 1:{halign:'right'}, 2:{halign:'right'} } })

  secHead('Nutrition')
  tRun({ ...tBase(JADE), head: [['When','Meal','Description','Calories','Protein (g)']],
    body: meals.length ? meals.sort((a,b)=>new Date(a.eaten_at)-new Date(b.eaten_at))
      .map(m=>[fmtT(m.eaten_at),clean(m.meal_type)||'—',clean(m.description||m.notes)||'—',n(m.calories,0),n(m.protein_g,0)])
      : empty(5),
    foot: meals.length?[['','',`Cycle total`,totalCal?Math.round(totalCal):'—',totalProt?Math.round(totalProt):'—']]:undefined,
    columnStyles: {0:{cellWidth:110},2:{cellWidth:140},3:{halign:'right'},4:{halign:'right'}} })

  secHead('Activity & movement', [24, 95, 165])
  const totalEnergy = acts.reduce((s,a)=>s+(Number(a.energy_kcal)||0),0)
  tRun({ ...tBase(BLUE), head: [['When','Type','Duration (min)','Distance (km)','Steps','Energy (kcal)']],
    body: acts.length ? acts.sort((a,b)=>new Date(a.started_at)-new Date(b.started_at))
      .map(a=>[fmtT(a.started_at),clean(a.type)||'—',n(a.duration_min,0),n(a.distance_km,2),a.steps?a.steps.toLocaleString():'—',n(a.energy_kcal,0)])
      : empty(6),
    foot: acts.length?[['','Total',Math.round(totalMin),'','',totalEnergy?Math.round(totalEnergy):'—']]:undefined,
    columnStyles:{0:{cellWidth:110},2:{halign:'right'},3:{halign:'right'},4:{halign:'right'},5:{halign:'right'}} })

  secHead('Sleep log', [83, 74, 183])
  tRun({ ...tBase(PURPLE), head: [['When','Hours','Quality /5','Notes']],
    body: (data.sleep||[]).length ? data.sleep.sort((a,b)=>new Date(a.logged_at)-new Date(b.logged_at))
      .map(s=>[fmtT(s.logged_at),n(s.hours,1),`${s.quality||'—'}/5`,clean(s.notes)])
      : empty(4), columnStyles:{0:{cellWidth:110}} })

  // ── header/footer every page ──────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages()
  const stamp = new Date().toLocaleString()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (p > 1) {
      doc.setFillColor(...DARK); doc.rect(0, 0, PW, 28, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...WHITE)
      doc.text('GLP-1 Progress Report', M, 18)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(150, 185, 172)
      doc.text(`${clean(profile?.full_name)||'Patient'} · ${fmtDate(window.start)}–${fmtDate(window.end)}`, PW-M, 18, { align: 'right' })
    }
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.4); doc.line(M, PH-28, PW-M, PH-28)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...FAINT)
    doc.text(`Generated ${stamp}  ·  Self-recorded patient data, for clinical review`, M, PH-16)
    doc.text(`Page ${p} of ${pages}`, PW-M, PH-16, { align: 'right' })
  }
  return doc
}

export function generateWeeklyPDF(args) {
  const doc = buildReportDoc(args)
  doc.save(`glp1-report-${fmtDate(args.window.end).replace(/[ ,]/g,'-')}.pdf`)
}
