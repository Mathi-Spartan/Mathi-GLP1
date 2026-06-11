import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateLong, fmtDate } from './week.js'

/* ============================================================
   GLP-1 Progress Report  —  doctor-facing weekly export
   Signature: two parallel "journeys" a GLP-1 patient lives —
   weight toward goal, and dose up the titration ladder —
   gated by GI tolerability. Same call contract as before:
     generateWeeklyPDF({ profile, appointment, window, data })
   No Supabase / data-shape changes.
   ============================================================ */

// ---- palette: clinical, calm, restrained ----
const INK = [19, 33, 28]
const GRAPHITE = [70, 85, 79]
const MIST = [139, 154, 147]
const FAINT = [176, 189, 183]
const HAIR = [228, 234, 231]
const HAIR2 = [214, 224, 219]
const PAPER = [251, 252, 251]
const CARD = [255, 255, 255]
const VEIL = [243, 247, 245]
const JADE = [13, 124, 92]
const JADE_DEEP = [9, 92, 68]
const JADE_WASH = [228, 242, 236]
const CLAY = [194, 79, 46]
const CLAY_DEEP = [158, 58, 31]
const CLAY_WASH = [248, 232, 226]
const AMBER = [176, 124, 28]
const AMBER_WASH = [248, 240, 222]
const GOLD = [161, 120, 38]
const WHITE = [255, 255, 255]

// CP1252-safe text (built-in font is Latin-1 + a few typographic glyphs)
const KEEP1252 =
  '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D' +
  '\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178'
function clean(s) {
  if (s == null) return ''
  const norm = String(s)
    .replace(/\u2212/g, '-').replace(/\u2191/g, 'up ').replace(/\u2193/g, 'down ')
    .replace(/[\u2192\u27a1]/g, '-> ')
  let out = ''
  for (const ch of norm) {
    const c = ch.charCodeAt(0)
    out += c <= 0xff || KEEP1252.indexOf(ch) >= 0 ? ch : '?'
  }
  return out
}
function n(v, d = 0) {
  if (v === null || v === undefined || v === '' || isNaN(v)) return '—'
  return Number(v).toFixed(d)
}
function int(v) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  return Math.round(Number(v)).toLocaleString()
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function ageFrom(dob) {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d)) return null
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 864e5))
}

// Standard titration ladders (mg) by molecule; falls back to observed doses.
function ladderFor(drug, observed) {
  const s = (drug || '').toLowerCase()
  if (s.includes('tirzep') || s.includes('mounjaro') || s.includes('zepbound'))
    return { name: 'Tirzepatide', steps: [2.5, 5, 7.5, 10, 12.5, 15] }
  if (s.includes('semaglu') || s.includes('ozempic') || s.includes('wegovy'))
    return { name: 'Semaglutide', steps: [0.25, 0.5, 1, 1.7, 2.4] }
  if (s.includes('lira') || s.includes('saxenda') || s.includes('victoza'))
    return { name: 'Liraglutide', steps: [0.6, 1.2, 1.8, 2.4, 3.0] }
  if (s.includes('dulagl') || s.includes('trulicity'))
    return { name: 'Dulaglutide', steps: [0.75, 1.5, 3, 4.5] }
  const uniq = [...new Set(observed.filter((d) => d != null))].sort((a, b) => a - b)
  return { name: drug ? clean(drug) : 'GLP-1', steps: uniq.length ? uniq : [] }
}

const GI_TYPES = ['nausea', 'vomit', 'gi', 'stomach', 'constip', 'diarr', 'reflux', 'bloat']
function isGI(t) {
  const s = (t || '').toLowerCase()
  return GI_TYPES.some((g) => s.includes(g))
}

export function buildReportDoc({ profile, appointment, window, data }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 40
  const CW = PW - M * 2
  let y = 0

  // ---------------- derive ----------------
  const weights = [...(data.weights || [])].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const firstW = weights[0]?.weight_kg ?? null
  const lastW = weights[weights.length - 1]?.weight_kg ?? null
  const cycleStartW = data.prevWeight ?? firstW
  const baselineW = profile?.baseline_weight_kg ?? null
  const height = profile?.height_cm ?? null
  const age = ageFrom(profile?.dob)

  const spanDays = Math.max(1, Math.round((new Date(window.end) - new Date(window.start)) / 864e5))
  const dCycle = lastW != null && cycleStartW != null ? lastW - cycleStartW : null
  const weeklyRate = dCycle != null ? dCycle / (spanDays / 7) : null

  const bmi = lastW && height ? lastW / Math.pow(height / 100, 2) : null
  const bmiBand = bmi == null ? '' : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Healthy' : bmi < 30 ? 'Overweight' : 'Obese'
  // goal = weight at upper-healthy BMI 25 (clinical default; no goal stored)
  const goalW = height ? 24.9 * Math.pow(height / 100, 2) : null
  const lostVsBase = baselineW != null && lastW != null ? baselineW - lastW : null
  const pctVsBase = baselineW ? (lostVsBase / baselineW) * 100 : null
  const toGo = goalW != null && lastW != null ? lastW - goalW : null
  const journeyTotal = baselineW != null && goalW != null ? baselineW - goalW : null
  const journeyPct = journeyTotal && journeyTotal > 0 ? Math.max(0, Math.min(1, (baselineW - lastW) / journeyTotal)) : null
  const weeksToGoal = toGo != null && weeklyRate != null && weeklyRate < -0.05 ? toGo / -weeklyRate : null

  const inj = [...(data.injections || [])].sort((a, b) => new Date(a.injected_at) - new Date(b.injected_at))
  const doseObs = inj.map((i) => (i.dose_mg != null ? Number(i.dose_mg) : null))
  const lastDose = [...doseObs].reverse().find((d) => d != null) ?? null
  const lastDrug = [...inj].reverse().find((i) => i.drug)?.drug ?? profile?.glp1_drug ?? null
  const ladder = ladderFor(lastDrug, doseObs)
  const curRung = lastDose != null ? ladder.steps.findIndex((s) => Math.abs(s - lastDose) < 1e-6) : -1
  const nextDose = curRung >= 0 && curRung < ladder.steps.length - 1 ? ladder.steps[curRung + 1] : null

  const allSymp = data.symptoms || []
  const sideFx = allSymp.filter((s) => (s.type || '').toLowerCase() !== 'craving')
  const cravings = allSymp.filter((s) => (s.type || '').toLowerCase() === 'craving')
  const giFx = sideFx.filter((s) => isGI(s.type))
  const peakSev = sideFx.reduce((m, s) => Math.max(m, Number(s.severity) || 0), 0)
  const tol = sideFx.length === 0 ? { label: 'No symptoms', tone: JADE, k: 0 }
    : peakSev >= 4 ? { label: 'Significant', tone: CLAY, k: 3 }
    : peakSev === 3 ? { label: 'Moderate', tone: AMBER, k: 2 }
    : { label: 'Mild', tone: JADE, k: 1 }

  const avgCraving = cravings.length ? cravings.reduce((a, c) => a + (Number(c.severity) || 0), 0) / cravings.length : null
  // craving trend: first half vs second half of the cycle
  let cravingTrend = null
  if (cravings.length >= 2) {
    const sorted = [...cravings].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
    const mid = Math.floor(sorted.length / 2)
    const avg = (arr) => arr.reduce((s, c) => s + (Number(c.severity) || 0), 0) / arr.length
    cravingTrend = avg(sorted.slice(mid)) - avg(sorted.slice(0, mid))
  }

  const meals = data.meals || []
  const totalProt = meals.reduce((s, m) => s + (Number(m.protein_g) || 0), 0)
  const totalCal = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0)
  const protPerDay = meals.length ? totalProt / spanDays : null
  const protPerKg = protPerDay != null && lastW ? protPerDay / lastW : null

  const acts = data.activities || []
  const stepRows = acts.filter((a) => a.steps != null)
  const totalSteps = stepRows.reduce((s, a) => s + (a.steps || 0), 0)
  const avgSteps = stepRows.length ? Math.round(totalSteps / spanDays) : null
  const totalEnergy = acts.reduce((s, a) => s + (Number(a.energy_kcal) || 0), 0)
  const totalActiveMin = acts.reduce((s, a) => s + (Number(a.duration_min) || 0), 0)
  const strengthMin = acts.filter((a) => /strength|weight|resist/i.test(a.type || '')).reduce((s, a) => s + (Number(a.duration_min) || 0), 0)

  const water = data.water || []
  const totalWater = water.reduce((s, w) => s + (Number(w.amount_ml) || 0), 0)
  const avgWater = water.length ? totalWater / spanDays : null

  // ============================================================
  //  MASTHEAD
  // ============================================================
  doc.setFillColor(...JADE)
  doc.roundedRect(M, 36, 24, 24, 6, 6, 'F')
  doc.setDrawColor(...WHITE); doc.setLineWidth(1.5); doc.setLineJoin('round')
  doc.lines([[2.5, 0], [1.7, -5], [2.6, 10], [2.6, -7.5], [1.7, 2.5], [2.5, 0]], M + 4.5, 48, [1, 1])
  doc.setLineWidth(1)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...INK)
  doc.text('GLP-1 Progress Report', M + 34, 46)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MIST)
  doc.text(`${clean(profile?.full_name) || 'Patient'}   ·   ${fmtDateLong(window.start)} – ${fmtDateLong(window.end)}`, M + 34, 58)

  const rx = PW - M
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(...FAINT)
  doc.text('NEXT REVIEW', rx, 42, { align: 'right' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK)
  doc.text(fmtDateLong(appointment.appointment_date), rx, 53, { align: 'right' })
  if (appointment?.clinician) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MIST)
    doc.text(clean(appointment.clinician), rx, 63, { align: 'right' })
  }
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.6); doc.line(M, 72, PW - M, 72)
  y = 88

  // ============================================================
  //  HERO — WEIGHT JOURNEY (signature 1)
  // ============================================================
  const heroH = 150
  doc.setFillColor(...CARD); doc.setDrawColor(...HAIR); doc.setLineWidth(0.8)
  doc.roundedRect(M, y, CW, heroH, 8, 8, 'FD')
  const padX = 20
  const leftW = CW * 0.56
  // eyebrow
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
  doc.text('W E I G H T   J O U R N E Y', M + padX, y + 22)
  // current weight, large
  doc.setFont('helvetica', 'bold'); doc.setFontSize(40); doc.setTextColor(...INK)
  doc.text(lastW != null ? `${n(lastW, 1)}` : '—', M + padX, y + 60)
  const wW = doc.getTextWidth(lastW != null ? `${n(lastW, 1)}` : '—')
  doc.setFontSize(12); doc.setTextColor(...MIST)
  doc.text('kg', M + padX + wW + 6, y + 60)
  // change badges
  let bx = M + padX
  const by = y + 76
  function badge(text, tone, wash) {
    const w = doc.getTextWidth(text) + 16
    doc.setFillColor(...wash); doc.roundedRect(bx, by, w, 16, 8, 8, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...tone)
    doc.text(text, bx + 8, by + 11)
    bx += w + 6
  }
  if (dCycle != null) badge(`${dCycle <= 0 ? 'Down' : 'Up'} ${Math.abs(dCycle).toFixed(1)} kg this week`, dCycle <= 0 ? JADE_DEEP : CLAY_DEEP, dCycle <= 0 ? JADE_WASH : CLAY_WASH)
  if (pctVsBase != null) badge(`${pctVsBase >= 0 ? '-' : '+'}${Math.abs(pctVsBase).toFixed(1)}% from baseline`, JADE_DEEP, JADE_WASH)

  // journey track baseline -> goal
  const trackX = M + padX
  const trackW = leftW - padX - 6
  const trackY = y + heroH - 34
  if (baselineW != null && goalW != null && lastW != null && journeyPct != null) {
    doc.setFillColor(...VEIL); doc.roundedRect(trackX, trackY, trackW, 9, 4.5, 4.5, 'F')
    const fillW = Math.max(4, trackW * journeyPct)
    doc.setFillColor(...JADE); doc.roundedRect(trackX, trackY, fillW, 9, 4.5, 4.5, 'F')
    // current marker
    const mx = trackX + fillW
    doc.setFillColor(...WHITE); doc.setDrawColor(...JADE_DEEP); doc.setLineWidth(1.6)
    doc.circle(mx, trackY + 4.5, 4.6, 'FD')
    // end labels
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GRAPHITE)
    doc.text(`${baselineW.toFixed(1)}`, trackX, trackY - 6)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(...MIST)
    doc.text('baseline', trackX, trackY + 19)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GRAPHITE)
    doc.text(`${goalW.toFixed(1)}`, trackX + trackW, trackY - 6, { align: 'right' })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(...MIST)
    doc.text('goal · BMI 25', trackX + trackW, trackY + 19, { align: 'right' })
    // mid annotation
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...JADE_DEEP)
    const mid = `${lostVsBase != null ? lostVsBase.toFixed(1) : '—'} kg lost  ·  ${Math.round(journeyPct * 100)}% to goal  ·  ${toGo != null ? toGo.toFixed(1) : '—'} kg to go`
    doc.text(mid, trackX + trackW / 2, trackY + 19, { align: 'center' })
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...MIST)
    doc.text('Add height and baseline weight in settings to chart the journey to goal.', trackX, trackY + 4)
  }

  // right: weekly trend mini-chart
  const rX = M + leftW + 6
  const rW = CW - leftW - padX - 6
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.6); doc.line(M + leftW, y + 16, M + leftW, y + heroH - 16)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
  doc.text('T H I S   W E E K', rX, y + 22)
  const pts = weights.map((w) => ({ v: Number(w.weight_kg), t: new Date(w.logged_at) }))
  if (pts.length >= 2) {
    const plot = { x: rX, y: y + 34, w: rW, h: heroH - 78 }
    const vals = pts.map((p) => p.v).concat(baselineW != null ? [baselineW] : [])
    let mn = Math.min(...vals) - 0.4, mx = Math.max(...vals) + 0.4
    if (mx - mn < 1) { mx += 0.5; mn -= 0.5 }
    const px = (i) => plot.x + (i / (pts.length - 1)) * plot.w
    const py = (v) => plot.y + (1 - (v - mn) / (mx - mn)) * plot.h
    if (baselineW != null && baselineW >= mn && baselineW <= mx) {
      doc.setDrawColor(...FAINT); doc.setLineWidth(0.7); doc.setLineDashPattern([2, 2], 0)
      doc.line(plot.x, py(baselineW), plot.x + plot.w, py(baselineW)); doc.setLineDashPattern([], 0)
    }
    const bottom = plot.y + plot.h
    for (let i = 1; i < pts.length; i++) {
      doc.setFillColor(...JADE_WASH)
      doc.triangle(px(i - 1), py(pts[i - 1].v), px(i), py(pts[i].v), px(i - 1), bottom, 'F')
      doc.triangle(px(i), py(pts[i].v), px(i), bottom, px(i - 1), bottom, 'F')
    }
    doc.setDrawColor(...JADE); doc.setLineWidth(2)
    for (let i = 1; i < pts.length; i++) doc.line(px(i - 1), py(pts[i - 1].v), px(i), py(pts[i].v))
    pts.forEach((p, i) => {
      const last = i === pts.length - 1
      doc.setFillColor(...(last ? JADE : WHITE)); doc.setDrawColor(...JADE); doc.setLineWidth(1.1)
      doc.circle(px(i), py(p.v), last ? 2.8 : 1.7, last ? 'F' : 'FD')
    })
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.2); doc.setTextColor(...MIST)
    doc.text(fmtDate(pts[0].t), plot.x, bottom + 11)
    doc.text(fmtDate(pts[pts.length - 1].t), plot.x + plot.w, bottom + 11, { align: 'right' })
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MIST)
    doc.text('Not enough readings', rX, y + heroH / 2)
  }
  y += heroH + 14

  // ============================================================
  //  DOSE TITRATION LADDER (signature 2)
  // ============================================================
  const ladH = 70
  doc.setFillColor(...CARD); doc.setDrawColor(...HAIR); doc.setLineWidth(0.8)
  doc.roundedRect(M, y, CW, ladH, 8, 8, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...MIST)
  doc.text('D O S E   T I T R A T I O N', M + 20, y + 19)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GRAPHITE)
  doc.text(ladder.name, M + 20 + doc.getTextWidth('D O S E   T I T R A T I O N') + 10, y + 19)
  // right: next step note
  if (nextDose != null) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...JADE_DEEP)
    doc.text(`Next step: ${nextDose} mg`, PW - M - 20, y + 19, { align: 'right' })
  } else if (lastDose != null) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...JADE_DEEP)
    doc.text('At maintenance dose', PW - M - 20, y + 19, { align: 'right' })
  }
  // rungs
  if (ladder.steps.length) {
    const lx = M + 24
    const lw = CW - 48
    const ly = y + 44
    const gap = lw / (ladder.steps.length - 1 || 1)
    // base line
    doc.setDrawColor(...HAIR2); doc.setLineWidth(1.4); doc.line(lx, ly, lx + lw, ly)
    if (curRung > 0) { doc.setDrawColor(...JADE); doc.setLineWidth(2.4); doc.line(lx, ly, lx + (ladder.steps.length === 1 ? 0 : gap * curRung), ly) }
    ladder.steps.forEach((s, i) => {
      const cxp = ladder.steps.length === 1 ? lx + lw / 2 : lx + gap * i
      const done = curRung >= 0 && i <= curRung
      const cur = i === curRung
      if (cur) { doc.setFillColor(...JADE); doc.setDrawColor(...JADE) }
      else if (done) { doc.setFillColor(...JADE); doc.setDrawColor(...JADE) }
      else { doc.setFillColor(...WHITE); doc.setDrawColor(...HAIR2) }
      doc.setLineWidth(1.2); doc.circle(cxp, ly, cur ? 5.5 : 3.4, 'FD')
      if (cur) { doc.setFillColor(...WHITE); doc.circle(cxp, ly, 2, 'F') }
      doc.setFont('helvetica', cur ? 'bold' : 'normal'); doc.setFontSize(cur ? 8.5 : 7.5)
      doc.setTextColor(...(cur ? INK : done ? JADE_DEEP : MIST))
      doc.text(`${s}`, cxp, ly + 16, { align: 'center' })
    })
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(...MIST)
    doc.text('No dose recorded this cycle.', M + 24, y + 44)
  }
  y += ladH + 14

  // ============================================================
  //  GLP-1 VITALS  — refined stat blocks (2 x 4)
  // ============================================================
  const vitals = [
    { l: 'RATE OF LOSS', v: weeklyRate != null ? `${weeklyRate > 0 ? '+' : ''}${weeklyRate.toFixed(2)}` : '—', u: 'kg / wk', tone: weeklyRate == null ? INK : weeklyRate <= 0 ? JADE : CLAY },
    { l: 'BMI', v: bmi != null ? n(bmi, 1) : '—', u: bmiBand },
    { l: 'TIME TO GOAL', v: weeksToGoal != null ? `${Math.round(weeksToGoal)}` : '—', u: weeksToGoal != null ? 'weeks*' : 'at goal' },
    { l: 'GI TOLERABILITY', v: tol.label, tone: tol.tone, small: true, u: giFx.length ? `${giFx.length} event${giFx.length > 1 ? 's' : ''}` : '' },
    { l: 'PROTEIN', v: protPerKg != null ? n(protPerKg, 2) : '—', u: 'g / kg/day', tone: protPerKg == null ? INK : protPerKg >= 1.2 ? JADE : AMBER },
    { l: 'CRAVINGS', v: avgCraving != null ? `${avgCraving.toFixed(1)}` : '—', u: avgCraving != null ? 'avg / 5' : 'none', tone: cravingTrend == null ? INK : cravingTrend <= 0 ? JADE : CLAY },
    { l: 'STEPS / DAY', v: avgSteps != null ? int(avgSteps) : '—', u: 'avg' },
    { l: 'HYDRATION', v: avgWater != null ? (avgWater / 1000).toFixed(1) : '—', u: 'L / day' },
  ]
  const vg = 9
  const vW = (CW - vg * 3) / 4
  const vH = 50
  vitals.forEach((t, i) => {
    const col = i % 4, row = Math.floor(i / 4)
    const x = M + col * (vW + vg), ty = y + row * (vH + vg)
    doc.setFillColor(...CARD); doc.setDrawColor(...HAIR); doc.setLineWidth(0.7)
    doc.roundedRect(x, ty, vW, vH, 6, 6, 'FD')
    doc.setFillColor(...(t.tone || JADE)); doc.roundedRect(x, ty + 8, 3, vH - 16, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2); doc.setTextColor(...MIST)
    doc.text(t.l, x + 11, ty + 16)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(t.small ? 12 : 18); doc.setTextColor(...(t.tone || INK))
    doc.text(String(t.v), x + 11, ty + (t.small ? 33 : 36))
    if (t.u) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...FAINT)
      doc.text(t.u, x + 11, ty + 44)
    }
  })
  y += vH * 2 + vg + 12

  // ---- clinician one-liner ----
  const flagged = tol.k >= 3
  const tldr = []
  if (dCycle != null) tldr.push(`${dCycle <= 0 ? 'Down' : 'Up'} ${Math.abs(dCycle).toFixed(1)} kg this week`)
  if (pctVsBase != null) tldr.push(`${pctVsBase >= 0 ? '-' : '+'}${Math.abs(pctVsBase).toFixed(1)}% from baseline`)
  if (lastDose != null) tldr.push(`${lastDose} mg ${clean(ladder.name)}`)
  tldr.push(`GI ${tol.label.toLowerCase()}`)
  if (avgCraving != null) tldr.push(`cravings ${avgCraving.toFixed(1)}/5${cravingTrend != null ? (cravingTrend <= 0 ? ' (easing)' : ' (rising)') : ''}`)
  const cH = 26
  doc.setFillColor(...(flagged ? CLAY_WASH : VEIL)); doc.roundedRect(M, y, CW, cH, 5, 5, 'F')
  doc.setFillColor(...(flagged ? CLAY : JADE)); doc.roundedRect(M, y, 3.5, cH, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...(flagged ? CLAY_DEEP : JADE_DEEP))
  doc.text('SUMMARY', M + 13, y + 11)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.3); doc.setTextColor(...INK)
  doc.text(tldr.join('   ·   '), M + 13, y + 20, { maxWidth: CW - 24 })
  y += cH + 4
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(...FAINT)
  doc.text('*Projection at this week\u2019s rate. Goal is the weight at BMI 25.0; not a clinical target unless set by your clinician.', M, y + 7, { maxWidth: CW })

  // ============================================================
  //  PAGE 2+  —  CLINICAL DETAIL
  // ============================================================
  function heading(text, tone = JADE_DEEP, sub) {
    if (y > PH - 120) { doc.addPage(); y = 52 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...tone)
    doc.text(text.toUpperCase(), M, y)
    if (sub) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MIST)
      doc.text(sub, PW - M, y, { align: 'right' })
    }
    y += 7
    doc.setDrawColor(...tone); doc.setLineWidth(1.4); doc.line(M, y, M + 22, y)
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M + 26, y, PW - M, y)
    y += 12
  }
  const base = (tone) => ({
    startY: y, margin: { left: M, right: M }, theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8.2, cellPadding: { top: 5.5, right: 7, bottom: 5.5, left: 7 }, textColor: INK, lineWidth: 0, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: tone, textColor: 255, fontSize: 7, fontStyle: 'bold', cellPadding: { top: 6, right: 7, bottom: 6, left: 7 } },
    bodyStyles: { fillColor: WHITE }, alternateRowStyles: { fillColor: VEIL },
    footStyles: { fillColor: JADE_WASH, textColor: JADE_DEEP, fontStyle: 'bold', fontSize: 7.6 },
  })
  function run(opts) { autoTable(doc, opts); y = doc.lastAutoTable.finalY + 18 }
  const empty = (c) => [[{ content: 'No entries recorded this cycle', colSpan: c, styles: { textColor: MIST, fontStyle: 'italic', halign: 'center' } }]]
  // severity-pip drawer factory
  const pipCol = (idx, toneHigh) => ({
    didParseCell: (h) => { if (h.section === 'body' && h.column.index === idx && h.cell.raw && typeof h.cell.raw === 'object') h.cell.text = [''] },
    didDrawCell: (h) => {
      if (h.section === 'body' && h.column.index === idx && h.cell.raw && typeof h.cell.raw === 'object') {
        const sev = h.cell.raw.sev, r = 2.3, gap = 8
        const sx = h.cell.x + 7, my = h.cell.y + h.cell.height / 2
        for (let k = 1; k <= 5; k++) {
          const filled = k <= sev
          const tone = toneHigh ? (sev >= 4 ? CLAY : sev >= 3 ? AMBER : JADE) : JADE
          if (filled) { doc.setFillColor(...tone); doc.setDrawColor(...tone) } else { doc.setFillColor(...WHITE); doc.setDrawColor(...HAIR2) }
          doc.setLineWidth(0.5); doc.circle(sx + (k - 1) * gap, my, r, filled ? 'F' : 'FD')
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MIST); doc.text(`${sev}/5`, sx + 5 * gap + 2, my + 2)
      }
    },
  })

  // --- GI tolerability / side effects (the titration gate) ---
  doc.addPage(); y = 52
  heading('Tolerability & side effects', CLAY, 'the gate on dose escalation')
  run({
    ...base(CLAY),
    head: [['When', 'Symptom', 'GI', 'Severity', 'Notes']],
    body: sideFx.length
      ? sideFx.slice().sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
          .map((s) => [fmtTime(s.occurred_at), clean(s.type) || '—', isGI(s.type) ? 'GI' : '', { sev: Number(s.severity) || 0 }, clean(s.notes)])
      : empty(5),
    columnStyles: { 0: { cellWidth: 94 }, 2: { cellWidth: 26, halign: 'center', textColor: CLAY_DEEP, fontStyle: 'bold' }, 3: { cellWidth: 78 } },
    ...pipCol(3, true),
  })

  // --- cravings / food noise ---
  if (cravings.length) {
    heading('Cravings & food noise', JADE, 'GLP-1 efficacy signal — lower is better')
    run({
      ...base(JADE),
      head: [['When', 'Intensity', 'What / notes']],
      body: cravings.slice().sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
        .map((c) => [fmtTime(c.occurred_at), { sev: Number(c.severity) || 0 }, clean(c.notes)]),
      columnStyles: { 0: { cellWidth: 94 }, 1: { cellWidth: 78 } },
      ...pipCol(1, false),
    })
  }

  // --- weight log with rate ---
  heading('Weight log')
  let prevWv = data.prevWeight ?? null
  run({
    ...base(INK),
    head: [['When', 'Weight (kg)', 'Change (kg)', 'Source']],
    body: weights.length
      ? weights.map((w) => { const val = Number(w.weight_kg); const d = prevWv != null ? val - prevWv : null; prevWv = val; return [fmtTime(w.logged_at), n(val, 1), { d }, clean(w.source) || 'manual'] })
      : empty(4),
    columnStyles: { 0: { cellWidth: 110 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') {
        const d = h.cell.raw.d
        if (d == null) h.cell.text = ['—']
        else { h.cell.text = [`${d > 0 ? '+' : ''}${d.toFixed(1)}`]; h.cell.styles.textColor = d <= 0 ? JADE : CLAY; h.cell.styles.fontStyle = 'bold' }
      }
    },
  })

  // --- nutrition with protein focus ---
  heading('Nutrition', JADE, 'protein protects lean mass on GLP-1')
  run({
    ...base(JADE),
    head: [['When', 'Meal', 'Description', 'Calories', 'Protein (g)']],
    body: meals.length
      ? meals.slice().sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at))
          .map((m) => [fmtTime(m.eaten_at), clean(m.meal_type) || '—', clean(m.description || m.notes) || '—', n(m.calories), n(m.protein_g)])
      : empty(5),
    foot: meals.length ? [['', '', `Cycle total  ·  ${protPerKg != null ? protPerKg.toFixed(2) + ' g/kg/day' : ''}`, int(totalCal), int(totalProt)]] : undefined,
    columnStyles: { 0: { cellWidth: 94 }, 2: { cellWidth: 150 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  })

  // --- activity (lean mass: resistance vs cardio) ---
  heading('Activity & movement', JADE, strengthMin ? `${Math.round(strengthMin)} min resistance training` : undefined)
  run({
    ...base(JADE),
    head: [['When', 'Type', 'Duration (min)', 'Distance (km)', 'Steps', 'Energy (kcal)']],
    body: acts.length
      ? acts.slice().sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
          .map((a) => [fmtTime(a.started_at), clean(a.type) || '—', n(a.duration_min, 0), n(a.distance_km, 2), a.steps != null ? a.steps.toLocaleString() : '—', n(a.energy_kcal, 0)])
      : empty(6),
    foot: acts.length ? [['', 'Total', int(totalActiveMin), '', int(totalSteps), int(totalEnergy)]] : undefined,
    columnStyles: { 0: { cellWidth: 94 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })

  // --- hydration ---
  heading('Hydration')
  const byDay = {}
  water.forEach((w) => { const d = fmtDate(w.logged_at); byDay[d] = (byDay[d] || 0) + (Number(w.amount_ml) || 0) })
  const days = Object.entries(byDay)
  const maxMl = days.reduce((m, [, v]) => Math.max(m, v), 0) || 1
  run({
    ...base(JADE),
    head: [['Day', 'Total (ml)', 'Intake']],
    body: days.length ? days.map(([d, ml]) => [d, Math.round(ml).toLocaleString(), { ml, max: maxMl }]) : empty(3),
    columnStyles: { 1: { halign: 'right', cellWidth: 90 }, 2: { cellWidth: 200 } },
    didParseCell: (h) => { if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') h.cell.text = [''] },
    didDrawCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') {
        const { ml, max } = h.cell.raw, bw = (h.cell.width - 14) * Math.max(0.04, ml / max), by = h.cell.y + h.cell.height / 2 - 3
        doc.setFillColor(...JADE_WASH); doc.roundedRect(h.cell.x + 7, by, h.cell.width - 14, 6, 2, 2, 'F')
        doc.setFillColor(...JADE); doc.roundedRect(h.cell.x + 7, by, bw, 6, 2, 2, 'F')
      }
    },
  })

  // --- injection / titration history ---
  heading('Injection history', CLAY)
  run({
    ...base(CLAY),
    head: [['When', 'Drug', 'Dose (mg)', 'Site', 'Lot', 'Notes']],
    body: inj.length
      ? inj.map((i) => [fmtTime(i.injected_at), clean(i.drug) || '—', n(i.dose_mg, 2), clean(i.site) || '—', clean(i.lot) || '—', clean(i.notes)])
      : empty(6),
    columnStyles: { 0: { cellWidth: 94 }, 2: { halign: 'right' } },
  })

  // --- medication adherence ---
  heading('Medication adherence')
  const taken = {}
  ;(data.medicationLogs || []).forEach((l) => { taken[l.medication_id] = (taken[l.medication_id] || 0) + 1 })
  const medName = {}
  ;(data.medications || []).forEach((m) => (medName[m.id] = true))
  const medRows = (data.medications || []).map((m) => [clean(m.name) || '—', clean(m.dose) || '—', clean(m.schedule) || '—', String(taken[m.id] || 0)])
  Object.keys(taken).forEach((mid) => { if (!medName[mid]) medRows.push(['(unlisted)', '—', '—', String(taken[mid])]) })
  run({
    ...base(INK),
    head: [['Medication', 'Dose', 'Schedule', 'Times taken']],
    body: medRows.length ? medRows : empty(4),
    columnStyles: { 3: { halign: 'right' } },
  })

  // ============================================================
  //  HEADER (p>1) + FOOTER
  // ============================================================
  const pages = doc.internal.getNumberOfPages()
  const stamp = new Date().toLocaleString()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (p > 1) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GRAPHITE)
      doc.text('GLP-1 Progress Report', M, 30)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MIST)
      doc.text(`${clean(profile?.full_name) || 'Patient'} · ${fmtDate(window.start)}–${fmtDate(window.end)}`, PW - M, 30, { align: 'right' })
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M, 36, PW - M, 36)
    }
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M, PH - 30, PW - M, PH - 30)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...FAINT)
    doc.text(`Generated ${stamp}  ·  Self-recorded patient data, for clinical review`, M, PH - 18)
    doc.text(`Page ${p} of ${pages}`, PW - M, PH - 18, { align: 'right' })
  }
  return doc
}

export function generateWeeklyPDF(args) {
  const doc = buildReportDoc(args)
  doc.save(`glp1-report-${fmtDate(args.window.end).replace(/[ ,]/g, '-')}.pdf`)
}
