import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateLong, fmtDate } from './week.js'

/* ============================================================
   Doctor's Weekly Report — modern clinical export
   Same call contract as before:
     generateWeeklyPDF({ profile, appointment, window, data })
   Only the presentation changed. No Supabase / data shape edits.
   ============================================================ */

// ---- palette (cohesive with the app: teal + coral on paper) ----
const INK = [17, 38, 31]
const TEAL = [14, 122, 92]
const TEAL_DEEP = [9, 86, 64]
const CORAL = [200, 71, 47]
const AMBER = [196, 138, 30]
const MUTED = [110, 126, 119]
const FAINT = [150, 164, 157]
const HAIR = [226, 233, 229]
const SOFT = [246, 250, 248]
const TEAL_SOFT = [224, 240, 234]
const CORAL_SOFT = [250, 235, 231]
const WHITE = [255, 255, 255]

// ---- tiny format helpers ----
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
// The built-in PDF font covers Latin-1 + the CP1252 typographic set
// (en/em dash, curly quotes, bullet, ellipsis). A few glyphs are NOT
// covered (minus sign, arrows, Greek) and render as stray characters,
// so normalise those to ASCII and drop anything else out of range.
const KEEP1252 =
  '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D' +
  '\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178'
function clean(s) {
  if (s == null) return ''
  const norm = String(s)
    .replace(/\u2212/g, '-')
    .replace(/\u2191/g, 'up ')
    .replace(/\u2193/g, 'down ')
    .replace(/[\u2192\u27a1]/g, '-> ')
  let out = ''
  for (const ch of norm) {
    const c = ch.charCodeAt(0)
    out += c <= 0xff || KEEP1252.indexOf(ch) >= 0 ? ch : '?'
  }
  return out
}
function ageFrom(dob) {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d)) return null
  const diff = Date.now() - d.getTime()
  return Math.floor(diff / (365.25 * 24 * 3600 * 1000))
}
function bmiOf(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null
  const m = heightCm / 100
  return weightKg / (m * m)
}
function bmiBand(bmi) {
  if (bmi == null) return ''
  if (bmi < 18.5) return 'Underweight'
  if (bmi < 25) return 'Normal'
  if (bmi < 30) return 'Overweight'
  return 'Obese'
}

export function buildReportDoc({ profile, appointment, window, data }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const PW = doc.internal.pageSize.getWidth()
  const PH = doc.internal.pageSize.getHeight()
  const M = 36
  const CW = PW - M * 2

  // ---------- derive everything from real fields ----------
  const weights = [...(data.weights || [])].sort(
    (a, b) => new Date(a.logged_at) - new Date(b.logged_at)
  )
  const firstW = weights[0]?.weight_kg ?? null
  const lastW = weights[weights.length - 1]?.weight_kg ?? null
  const cycleStartW = data.prevWeight ?? firstW
  const baselineW = profile?.baseline_weight_kg ?? null

  const dCycle = lastW != null && cycleStartW != null ? lastW - cycleStartW : null
  const dBase = lastW != null && baselineW != null ? lastW - baselineW : null

  const bmi = bmiOf(lastW, profile?.height_cm)
  const age = ageFrom(profile?.dob)

  const inj = [...(data.injections || [])].sort(
    (a, b) => new Date(a.injected_at) - new Date(b.injected_at)
  )
  const lastDose = [...inj].reverse().find((i) => i.dose_mg != null)?.dose_mg ?? null
  const lastDrug = [...inj].reverse().find((i) => i.drug)?.drug ?? profile?.glp1_drug ?? null

  const meals = data.meals || []
  const totalCal = meals.reduce((s, m) => s + (Number(m.calories) || 0), 0)
  const totalProt = meals.reduce((s, m) => s + (Number(m.protein_g) || 0), 0)

  const acts = data.activities || []
  const stepRows = acts.filter((a) => a.steps != null)
  const totalSteps = stepRows.reduce((s, a) => s + (a.steps || 0), 0)
  const totalEnergy = acts.reduce((s, a) => s + (Number(a.energy_kcal) || 0), 0)
  const totalActiveMin = acts.reduce((s, a) => s + (Number(a.duration_min) || 0), 0)

  const water = data.water || []
  const totalWater = water.reduce((s, w) => s + (Number(w.amount_ml) || 0), 0)

  const allSymp = data.symptoms || []
  const symptoms = allSymp.filter((s) => (s.type || '').toLowerCase() !== 'craving')
  const cravings = allSymp.filter((s) => (s.type || '').toLowerCase() === 'craving')
  const peakSev = symptoms.reduce((m, s) => Math.max(m, Number(s.severity) || 0), 0)
  const avgCraving = cravings.length
    ? cravings.reduce((a, c) => a + (Number(c.severity) || 0), 0) / cravings.length
    : null

  // span of the cycle in days, for per-day averages
  const spanDays = Math.max(
    1,
    Math.round((new Date(window.end) - new Date(window.start)) / 86400000)
  )
  const avgSteps = stepRows.length ? Math.round(totalSteps / spanDays) : null
  const avgProt = meals.length ? totalProt / spanDays : null
  const avgWater = water.length ? totalWater / spanDays : null

  let y = 0

  // ============================================================
  //  MASTHEAD — light, modern (no dated dark band)
  // ============================================================
  // brand mark: rounded teal square with a white pulse glyph
  doc.setFillColor(...TEAL)
  doc.roundedRect(M, 38, 26, 26, 6, 6, 'F')
  doc.setDrawColor(...WHITE)
  doc.setLineWidth(1.4)
  doc.setLineJoin('round')
  const cx = M + 5
  const cy = 51
  doc.lines(
    [[3, 0], [2, -6], [3, 12], [3, -9], [2, 3], [3, 0]],
    cx, cy, [1, 1]
  )
  doc.setLineWidth(1)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...INK)
  doc.text('Weekly Health Report', M + 38, 50)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...MUTED)
  doc.text(
    `${clean(profile?.full_name) || 'Patient'}    ·    ${fmtDateLong(window.start)} – ${fmtDateLong(window.end)}`,
    M + 38,
    64
  )

  // right meta block
  const rx = PW - M
  function metaLine(label, value, yy) {
    if (!value) return yy
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...FAINT)
    doc.text(label.toUpperCase(), rx, yy, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...INK)
    doc.text(String(value), rx, yy + 11, { align: 'right' })
    return yy + 24
  }
  let my = 44
  my = metaLine('Appointment', fmtDateLong(appointment.appointment_date), my)

  // teal rule
  doc.setDrawColor(...TEAL)
  doc.setLineWidth(2)
  doc.line(M, 78, M + 34, 78)
  doc.setDrawColor(...HAIR)
  doc.setLineWidth(0.6)
  doc.line(M + 40, 78, PW - M, 78)

  y = 96

  // ============================================================
  //  CLINICAL IDENTITY STRIP — labeled cells, hairline dividers
  // ============================================================
  const idCells = [
    ['PATIENT', clean(profile?.full_name) || '—'],
    ['AGE / SEX', `${age != null ? age : '—'} / ${clean(profile?.sex) || '—'}`],
    ['HEIGHT', profile?.height_cm ? `${n(profile.height_cm, 0)} cm` : '—'],
    ['BASELINE WT', baselineW != null ? `${n(baselineW, 1)} kg` : '—'],
    ['MEDICATION', clean(lastDrug) || '—'],
    ['CURRENT DOSE', lastDose != null ? `${n(lastDose, 2)} mg` : '—'],
    ['CLINICIAN', clean(appointment?.clinician) || '—'],
  ]
  const stripH = 42
  doc.setFillColor(...SOFT)
  doc.setDrawColor(...HAIR)
  doc.setLineWidth(0.6)
  doc.roundedRect(M, y, CW, stripH, 5, 5, 'FD')
  const cellW = CW / idCells.length
  idCells.forEach((c, i) => {
    const x = M + i * cellW
    if (i > 0) {
      doc.setDrawColor(...HAIR)
      doc.setLineWidth(0.6)
      doc.line(x, y + 8, x, y + stripH - 8)
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(...FAINT)
    doc.text(c[0], x + 9, y + 16)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...INK)
    doc.text(String(c[1]), x + 9, y + 31, { maxWidth: cellW - 14 })
  })
  y += stripH + 16

  // ============================================================
  //  CLINICIAN TL;DR — one data-dense sentence in a callout
  // ============================================================
  const flagged = peakSev >= 4
  const tldr = []
  if (dCycle != null)
    tldr.push(`Weight ${dCycle <= 0 ? 'down' : 'up'} ${Math.abs(dCycle).toFixed(1)} kg this cycle`)
  if (dBase != null)
    tldr.push(`${dBase <= 0 ? '-' : '+'}${Math.abs(dBase).toFixed(1)} kg vs baseline`)
  tldr.push(
    inj.length
      ? `${inj.length} injection${inj.length > 1 ? 's' : ''}${lastDose != null ? ` (${n(lastDose, 2)} mg)` : ''}`
      : 'no injection logged'
  )
  tldr.push(
    symptoms.length
      ? `${symptoms.length} side effect${symptoms.length === 1 ? '' : 's'}, peak ${peakSev}/5`
      : 'no side effects'
  )
  if (cravings.length)
    tldr.push(`${cravings.length} craving${cravings.length === 1 ? '' : 's'}${avgCraving != null ? `, avg ${avgCraving.toFixed(1)}/5` : ''}`)
  if (avgProt != null) tldr.push(`protein ~${Math.round(avgProt)} g/day`)

  const calloutH = 30
  doc.setFillColor(...(flagged ? CORAL_SOFT : TEAL_SOFT))
  doc.roundedRect(M, y, CW, calloutH, 5, 5, 'F')
  doc.setFillColor(...(flagged ? CORAL : TEAL))
  doc.roundedRect(M, y, 4, calloutH, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...(flagged ? CORAL : TEAL_DEEP))
  doc.text('SUMMARY', M + 14, y + 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(tldr.join('   ·   '), M + 14, y + 23, { maxWidth: CW - 24 })
  y += calloutH + 16

  // ============================================================
  //  KPI TILES — 2 rows x 4, data-rich at a glance
  // ============================================================
  const tiles = [
    { label: 'CURRENT WEIGHT', value: lastW != null ? n(lastW, 1) : '—', unit: 'kg' },
    {
      label: 'CHANGE · CYCLE',
      value: dCycle == null ? '—' : `${dCycle > 0 ? '+' : ''}${dCycle.toFixed(1)}`,
      unit: 'kg', tone: dCycle == null ? INK : dCycle <= 0 ? TEAL : CORAL,
    },
    {
      label: 'CHANGE · BASELINE',
      value: dBase == null ? '—' : `${dBase > 0 ? '+' : ''}${dBase.toFixed(1)}`,
      unit: 'kg', tone: dBase == null ? INK : dBase <= 0 ? TEAL : CORAL,
    },
    { label: 'BMI', value: bmi != null ? n(bmi, 1) : '—', unit: bmiBand(bmi) },
    { label: 'AVG STEPS / DAY', value: avgSteps != null ? int(avgSteps) : '—', unit: 'steps' },
    { label: 'AVG PROTEIN / DAY', value: avgProt != null ? int(avgProt) : '—', unit: 'g' },
    { label: 'WATER / DAY', value: avgWater != null ? (avgWater / 1000).toFixed(1) : '—', unit: 'L' },
    {
      label: 'SIDE EFFECTS', value: String(symptoms.length),
      unit: symptoms.length ? `peak ${peakSev}/5` : 'none',
      tone: symptoms.length ? (flagged ? CORAL : AMBER) : TEAL,
    },
  ]
  const tGap = 10
  const tW = (CW - tGap * 3) / 4
  const tH = 56
  tiles.forEach((t, i) => {
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = M + col * (tW + tGap)
    const ty = y + row * (tH + tGap)
    doc.setDrawColor(...HAIR)
    doc.setLineWidth(0.6)
    doc.setFillColor(...WHITE)
    doc.roundedRect(x, ty, tW, tH, 5, 5, 'FD')
    // top accent tick
    doc.setFillColor(...(t.tone || TEAL))
    doc.roundedRect(x, ty, 18, 3, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.3)
    doc.setTextColor(...MUTED)
    doc.text(t.label, x + 10, ty + 17)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.setTextColor(...(t.tone || INK))
    doc.text(String(t.value), x + 10, ty + 39)
    // unit, placed after the value
    const vW = doc.getTextWidth(String(t.value))
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...FAINT)
    doc.text(t.unit || '', x + 10 + vW + 4, ty + 39)
  })
  y += tH * 2 + tGap + 16

  // ============================================================
  //  WEIGHT TREND CHART — baseline reference + area + line
  // ============================================================
  const chartH = 150
  doc.setDrawColor(...HAIR)
  doc.setLineWidth(0.6)
  doc.setFillColor(...WHITE)
  doc.roundedRect(M, y, CW, chartH, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...TEAL_DEEP)
  doc.text('WEIGHT TREND', M + 14, y + 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...FAINT)
  doc.text('this cycle, kg', M + 14 + doc.getTextWidth('WEIGHT TREND') + 8, y + 20)

  const pts = []
  weights.forEach((w) => pts.push({ v: Number(w.weight_kg), t: new Date(w.logged_at) }))

  if (pts.length >= 2) {
    const plot = { x: M + 50, y: y + 34, w: CW - 70, h: chartH - 62 }
    const refs = [...pts.map((p) => p.v)]
    if (baselineW != null) refs.push(baselineW)
    let mn = Math.min(...refs) - 0.5
    let mx = Math.max(...refs) + 0.5
    if (mx - mn < 1) { mx += 0.5; mn -= 0.5 }
    const px = (i) => plot.x + (i / (pts.length - 1)) * plot.w
    const py = (v) => plot.y + (1 - (v - mn) / (mx - mn)) * plot.h

    // frame + y labels
    doc.setDrawColor(...HAIR)
    doc.setLineWidth(0.5)
    doc.line(plot.x, plot.y, plot.x, plot.y + plot.h)
    doc.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...FAINT)
    doc.text(mx.toFixed(1), plot.x - 6, plot.y + 3, { align: 'right' })
    doc.text(mn.toFixed(1), plot.x - 6, plot.y + plot.h + 2, { align: 'right' })
    const midV = (mn + mx) / 2
    doc.text(midV.toFixed(1), plot.x - 6, py(midV) + 2, { align: 'right' })
    doc.setDrawColor(...SOFT)
    doc.line(plot.x, py(midV), plot.x + plot.w, py(midV))

    // baseline reference (dashed coral-muted)
    if (baselineW != null && baselineW >= mn && baselineW <= mx) {
      doc.setDrawColor(...FAINT)
      doc.setLineWidth(0.8)
      doc.setLineDashPattern([3, 2], 0)
      doc.line(plot.x, py(baselineW), plot.x + plot.w, py(baselineW))
      doc.setLineDashPattern([], 0)
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.text(`baseline ${baselineW.toFixed(1)}`, plot.x + plot.w, py(baselineW) - 3, { align: 'right' })
    }

    // soft filled area under the line
    const bottom = plot.y + plot.h
    for (let i = 1; i < pts.length; i++) {
      const x0 = px(i - 1), y0 = py(pts[i - 1].v)
      const x1 = px(i), y1 = py(pts[i].v)
      doc.setFillColor(...TEAL_SOFT)
      doc.triangle(x0, y0, x1, y1, x0, bottom, 'F')
      doc.triangle(x1, y1, x1, bottom, x0, bottom, 'F')
    }
    // line on top
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(2)
    for (let i = 1; i < pts.length; i++) {
      doc.line(px(i - 1), py(pts[i - 1].v), px(i), py(pts[i].v))
    }
    // dots
    pts.forEach((p, i) => {
      const last = i === pts.length - 1
      doc.setFillColor(...(last ? TEAL : WHITE))
      doc.setDrawColor(...TEAL)
      doc.setLineWidth(1.2)
      doc.circle(px(i), py(p.v), last ? 3 : 1.9, last ? 'F' : 'FD')
    })
    // endpoint value labels
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK)
    doc.text(pts[0].v.toFixed(1), px(0), py(pts[0].v) - 7, { align: 'center' })
    doc.text(pts[pts.length - 1].v.toFixed(1), px(pts.length - 1), py(pts[pts.length - 1].v) - 7, { align: 'center' })
    // x date ticks (first / last)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...FAINT)
    doc.text(fmtDate(pts[0].t), plot.x, plot.y + plot.h + 12)
    doc.text(fmtDate(pts[pts.length - 1].t), plot.x + plot.w, plot.y + plot.h + 12, { align: 'right' })
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text('Not enough weight readings this cycle to chart a trend.', M + 14, y + chartH / 2 + 4)
  }
  y += chartH + 16

  // ============================================================
  //  TWO CARDS: dose titration + intake/activity rollup
  // ============================================================
  const cardGap = 12
  const cW = (CW - cardGap) / 2
  const cardH = 96
  // left: dose titration
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.6); doc.setFillColor(...WHITE)
  doc.roundedRect(M, y, cW, cardH, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...CORAL)
  doc.text('DOSE TITRATION', M + 14, y + 19)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...INK)
  doc.text(lastDose != null ? `${n(lastDose, 2)} mg` : '—', M + 14, y + 44)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
  doc.text(lastDrug ? `current · ${clean(lastDrug)}` : 'current dose', M + 14, y + 56)
  // dose history chips
  const doseSeq = inj.filter((i) => i.dose_mg != null).map((i) => Number(i.dose_mg))
  const uniqDose = doseSeq.filter((d, i) => i === 0 || d !== doseSeq[i - 1])
  doc.setFontSize(7.5)
  let dx = M + 14
  const dyc = y + 74
  doc.setTextColor(...FAINT); doc.setFont('helvetica', 'normal')
  if (uniqDose.length) {
    const shown = uniqDose.slice(-5)
    shown.forEach((d, i) => {
      const lbl = `${d}`
      const w = doc.getTextWidth(lbl) + 12
      doc.setFillColor(...TEAL_SOFT); doc.roundedRect(dx, dyc - 8, w, 13, 3, 3, 'F')
      doc.setTextColor(...TEAL_DEEP); doc.setFont('helvetica', 'bold')
      doc.text(lbl, dx + 6, dyc + 1)
      dx += w + 4
      if (i < shown.length - 1) {
        doc.setFillColor(...FAINT)
        doc.triangle(dx, dyc - 4, dx, dyc + 1, dx + 4, dyc - 1.5, 'F')
        dx += 8
      }
    })
  } else {
    doc.text('No dose history this cycle.', M + 14, dyc)
  }
  if (appointment?.dose_change) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...CORAL)
    doc.text(`PLAN: ${clean(appointment.dose_change)}`, M + 14, y + cardH - 7, { maxWidth: cW - 28 })
  }

  // right: intake & activity
  const x2 = M + cW + cardGap
  doc.setDrawColor(...HAIR); doc.setLineWidth(0.6); doc.setFillColor(...WHITE)
  doc.roundedRect(x2, y, cW, cardH, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...TEAL_DEEP)
  doc.text('INTAKE & ACTIVITY', x2 + 14, y + 19)
  const roll = [
    ['Total calories', totalCal ? int(totalCal) + ' kcal' : '—'],
    ['Total protein', totalProt ? int(totalProt) + ' g' : '—'],
    ['Total water', totalWater ? (totalWater / 1000).toFixed(1) + ' L' : '—'],
    ['Total steps', totalSteps ? int(totalSteps) : '—'],
    ['Active energy', totalEnergy ? int(totalEnergy) + ' kcal' : '—'],
    ['Active minutes', totalActiveMin ? int(totalActiveMin) + ' min' : '—'],
  ]
  const colX = [x2 + 14, x2 + cW / 2 + 4]
  roll.forEach((r, i) => {
    const c = i % 2
    const rr = Math.floor(i / 2)
    const lx = colX[c]
    const ly = y + 36 + rr * 19
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
    doc.text(r[0], lx, ly)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
    doc.text(String(r[1]), lx + (cW / 2 - 18), ly, { align: 'right' })
  })
  y += cardH + 16

  // ============================================================
  //  DETAILED TABLES (flow onto following pages)
  // ============================================================
  function heading(text, tone = TEAL_DEEP) {
    if (y > PH - 110) { doc.addPage(); y = 54 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...tone)
    doc.text(text.toUpperCase(), M, y)
    y += 7
    doc.setDrawColor(...tone); doc.setLineWidth(1.4); doc.line(M, y, M + 24, y)
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M + 28, y, PW - M, y)
    y += 12
  }

  const baseTable = (tone) => ({
    startY: y,
    margin: { left: M, right: M },
    theme: 'striped',
    styles: {
      font: 'helvetica', fontSize: 8.3, cellPadding: { top: 5.5, right: 7, bottom: 5.5, left: 7 },
      textColor: INK, lineWidth: 0, overflow: 'linebreak', valign: 'middle',
    },
    headStyles: { fillColor: tone, textColor: 255, fontSize: 7.2, fontStyle: 'bold', cellPadding: { top: 6, right: 7, bottom: 6, left: 7 } },
    bodyStyles: { fillColor: WHITE },
    alternateRowStyles: { fillColor: SOFT },
    footStyles: { fillColor: TEAL_SOFT, textColor: TEAL_DEEP, fontStyle: 'bold', fontSize: 7.8 },
  })

  function run(opts) {
    autoTable(doc, opts)
    y = doc.lastAutoTable.finalY + 18
  }

  function emptyBody(cols) {
    return [[{ content: 'No entries recorded this cycle', colSpan: cols, styles: { textColor: MUTED, fontStyle: 'italic', halign: 'center' } }]]
  }

  // --- GLP-1 injections (coral) ---
  heading('GLP-1 injections', CORAL)
  run({
    ...baseTable(CORAL),
    head: [['When', 'Drug', 'Dose (mg)', 'Site', 'Lot', 'Notes']],
    body: inj.length
      ? inj.map((i) => [fmtTime(i.injected_at), clean(i.drug) || '—', n(i.dose_mg, 2), clean(i.site) || '—', clean(i.lot) || '—', clean(i.notes)])
      : emptyBody(6),
    columnStyles: { 2: { halign: 'right' }, 0: { cellWidth: 96 } },
  })

  // --- side effects (coral) with severity pips ---
  heading('Side effects & symptoms', CORAL)
  run({
    ...baseTable(CORAL),
    head: [['When', 'Type', 'Severity', 'Notes']],
    body: symptoms.length
      ? symptoms
          .slice()
          .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
          .map((s) => [fmtTime(s.occurred_at), clean(s.type) || '—', { sev: Number(s.severity) || 0 }, clean(s.notes)])
      : emptyBody(4),
    columnStyles: { 0: { cellWidth: 96 }, 2: { cellWidth: 80, halign: 'left' } },
    didParseCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') {
        h.cell.text = ['']
      }
    },
    didDrawCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') {
        const sev = h.cell.raw.sev
        const r = 2.3
        const gap = 8
        const startX = h.cell.x + 7
        const midY = h.cell.y + h.cell.height / 2
        for (let k = 1; k <= 5; k++) {
          const filled = k <= sev
          const tone = sev >= 4 ? CORAL : sev >= 3 ? AMBER : TEAL
          if (filled) { doc.setFillColor(...tone); doc.setDrawColor(...tone) }
          else { doc.setFillColor(...WHITE); doc.setDrawColor(...HAIR) }
          doc.setLineWidth(0.5)
          doc.circle(startX + (k - 1) * gap, midY, r, filled ? 'F' : 'FD')
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
        doc.text(`${sev}/5`, startX + 5 * gap + 2, midY + 2)
      }
    },
  })

  // --- cravings (efficacy signal, not adverse -> teal) ---
  if (cravings.length) {
    heading('Cravings', TEAL)
    run({
      ...baseTable(TEAL),
      head: [['When', 'Intensity', 'What / notes']],
      body: cravings
        .slice()
        .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
        .map((c) => [fmtTime(c.occurred_at), { sev: Number(c.severity) || 0 }, clean(c.notes)]),
      columnStyles: { 0: { cellWidth: 96 }, 1: { cellWidth: 80 } },
      didParseCell: (h) => {
        if (h.section === 'body' && h.column.index === 1 && h.cell.raw && typeof h.cell.raw === 'object') h.cell.text = ['']
      },
      didDrawCell: (h) => {
        if (h.section === 'body' && h.column.index === 1 && h.cell.raw && typeof h.cell.raw === 'object') {
          const sev = h.cell.raw.sev
          const r = 2.3, gap = 8
          const sx = h.cell.x + 7, midY = h.cell.y + h.cell.height / 2
          for (let k = 1; k <= 5; k++) {
            const filled = k <= sev
            if (filled) { doc.setFillColor(...TEAL); doc.setDrawColor(...TEAL) }
            else { doc.setFillColor(...WHITE); doc.setDrawColor(...HAIR) }
            doc.setLineWidth(0.5)
            doc.circle(sx + (k - 1) * gap, midY, r, filled ? 'F' : 'FD')
          }
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
          doc.text(`${sev}/5`, sx + 5 * gap + 2, midY + 2)
        }
      },
    })
  }

  // --- weight log with delta ---
  heading('Weight log')
  let prevWv = data.prevWeight ?? null
  const wBody = weights.length
    ? weights.map((w) => {
        const val = Number(w.weight_kg)
        const delta = prevWv != null ? val - prevWv : null
        prevWv = val
        return [fmtTime(w.logged_at), n(val, 1), { d: delta }, clean(w.source) || 'manual']
      })
    : emptyBody(4)
  run({
    ...baseTable(INK),
    head: [['When', 'Weight (kg)', 'Change (kg)', 'Source']],
    body: wBody,
    columnStyles: { 0: { cellWidth: 110 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    didParseCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') {
        const d = h.cell.raw.d
        if (d == null) { h.cell.text = ['—'] }
        else {
          h.cell.text = [`${d > 0 ? '+' : ''}${d.toFixed(1)}`]
          h.cell.styles.textColor = d <= 0 ? TEAL : CORAL
          h.cell.styles.fontStyle = 'bold'
        }
      }
    },
  })

  // --- nutrition with totals footer ---
  heading('Food & nutrition')
  run({
    ...baseTable(TEAL),
    head: [['When', 'Meal', 'Description', 'Calories', 'Protein (g)']],
    body: meals.length
      ? meals
          .slice()
          .sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at))
          .map((m) => [fmtTime(m.eaten_at), clean(m.meal_type) || '—', clean(m.description || m.notes) || '—', n(m.calories), n(m.protein_g)])
      : emptyBody(5),
    foot: meals.length ? [['', '', 'Cycle total', int(totalCal), int(totalProt)]] : undefined,
    columnStyles: { 0: { cellWidth: 96 }, 2: { cellWidth: 150 }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  })

  // --- activity ---
  heading('Activity & movement')
  run({
    ...baseTable(TEAL),
    head: [['When', 'Type', 'Duration (min)', 'Distance (km)', 'Steps', 'Energy (kcal)']],
    body: acts.length
      ? acts
          .slice()
          .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
          .map((a) => [fmtTime(a.started_at), clean(a.type) || '—', n(a.duration_min, 0), n(a.distance_km, 2), a.steps != null ? a.steps.toLocaleString() : '—', n(a.energy_kcal, 0)])
      : emptyBody(6),
    foot: acts.length ? [['', 'Total', int(totalActiveMin), '', int(totalSteps), int(totalEnergy)]] : undefined,
    columnStyles: { 0: { cellWidth: 96 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })

  // --- hydration by day with mini bars ---
  heading('Hydration')
  const byDay = {}
  water.forEach((w) => {
    const d = fmtDate(w.logged_at)
    byDay[d] = (byDay[d] || 0) + (Number(w.amount_ml) || 0)
  })
  const dayEntries = Object.entries(byDay)
  const maxMl = dayEntries.reduce((m, [, v]) => Math.max(m, v), 0) || 1
  run({
    ...baseTable(TEAL),
    head: [['Day', 'Total (ml)', 'Intake']],
    body: dayEntries.length
      ? dayEntries.map(([d, ml]) => [d, Math.round(ml).toLocaleString(), { ml, max: maxMl }])
      : emptyBody(3),
    columnStyles: { 1: { halign: 'right', cellWidth: 90 }, 2: { cellWidth: 200 } },
    didParseCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') h.cell.text = ['']
    },
    didDrawCell: (h) => {
      if (h.section === 'body' && h.column.index === 2 && h.cell.raw && typeof h.cell.raw === 'object') {
        const { ml, max } = h.cell.raw
        const bw = (h.cell.width - 14) * Math.max(0.04, ml / max)
        const by = h.cell.y + h.cell.height / 2 - 3
        doc.setFillColor(...TEAL_SOFT); doc.roundedRect(h.cell.x + 7, by, h.cell.width - 14, 6, 2, 2, 'F')
        doc.setFillColor(...TEAL); doc.roundedRect(h.cell.x + 7, by, bw, 6, 2, 2, 'F')
      }
    },
  })

  // --- medication adherence ---
  heading('Medication adherence')
  const medName = {}
  ;(data.medications || []).forEach((m) => (medName[m.id] = m))
  const takenCount = {}
  ;(data.medicationLogs || []).forEach((l) => {
    takenCount[l.medication_id] = (takenCount[l.medication_id] || 0) + 1
  })
  const medRows = (data.medications || []).map((m) => [
    clean(m.name) || '—', clean(m.dose) || '—', clean(m.schedule) || '—', String(takenCount[m.id] || 0),
  ])
  // include any logged meds not in the active list
  Object.keys(takenCount).forEach((mid) => {
    if (!medName[mid]) medRows.push(['(unlisted)', '—', '—', String(takenCount[mid])])
  })
  run({
    ...baseTable(INK),
    head: [['Medication', 'Dose', 'Schedule', 'Times taken']],
    body: medRows.length ? medRows : emptyBody(4),
    columnStyles: { 3: { halign: 'right' } },
  })

  // ============================================================
  //  RUNNING HEADER (p>1) + FOOTER on every page
  // ============================================================
  const pages = doc.internal.getNumberOfPages()
  const genStamp = new Date().toLocaleString()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    if (p > 1) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...MUTED)
      doc.text('Weekly Health Report', M, 30)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...FAINT)
      doc.text(`${clean(profile?.full_name) || 'Patient'} · ${fmtDate(window.start)}–${fmtDate(window.end)}`, PW - M, 30, { align: 'right' })
      doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M, 36, PW - M, 36)
    }
    doc.setDrawColor(...HAIR); doc.setLineWidth(0.5); doc.line(M, PH - 30, PW - M, PH - 30)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...FAINT)
    doc.text(`Generated ${genStamp}  ·  Self-recorded patient data, for clinical review`, M, PH - 18)
    doc.text(`Page ${p} of ${pages}`, PW - M, PH - 18, { align: 'right' })
  }

  return doc
}

export function generateWeeklyPDF(args) {
  const doc = buildReportDoc(args)
  const fileName = `health-report-${fmtDate(args.window.end).replace(/[ ,]/g, '-')}.pdf`
  doc.save(fileName)
}
