import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateLong, fmtDate, weekDays, sameDay } from './week.js'

/* ---------- clinical palette ---------- */
const INK = [17, 37, 32]
const GREEN = [14, 122, 92]
const GREEN_DEEP = [10, 93, 70]
const GREEN_SOFT = [223, 240, 233]
const BLOOM = [200, 71, 47]
const BLOOM_DEEP = [163, 52, 33]
const BLOOM_SOFT = [252, 229, 223]
const AMBER = [138, 90, 0]
const AMBER_SOFT = [255, 243, 213]
const LIME_SOFT = [233, 242, 214]
const MUTED = [120, 134, 128]
const FAINT = [168, 180, 174]
const LINE = [222, 231, 226]
const SOFT = [244, 248, 246]
const WHITE = [255, 255, 255]

/* ---------- small utils ---------- */
function n(v, d = 0) {
  if (v === null || v === undefined || isNaN(v)) return null
  return Number(v)
}
function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function sevFill(s) {
  return [LIME_SOFT, GREEN_SOFT, AMBER_SOFT, BLOOM_SOFT, BLOOM][Math.min(Math.max(s, 1), 5) - 1]
}
function sevText(s) {
  return [[90, 110, 40], GREEN_DEEP, AMBER, BLOOM_DEEP, WHITE][Math.min(Math.max(s, 1), 5) - 1]
}

export function generateWeeklyPDF({ profile, appointment, window, data }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 38
  const contentW = pageW - margin * 2
  let y = 0

  /* ================= per-day aggregation ================= */
  const apptDate = new Date(appointment.appointment_date + 'T12:00:00')
  const days = weekDays(apptDate) // 7 midnights, oldest -> appointment day
  const onDay = (arr, tf, day) => arr.filter((r) => sameDay(new Date(r[tf]), day))
  const sum = (arr, k) => arr.reduce((a, r) => a + (Number(r[k]) || 0), 0)

  const height = n(profile?.height_cm)
  const hasBMI = height && height > 0

  const daily = days.map((day) => {
    const w = onDay(data.weights, 'logged_at', day)
    const lastW = w.length ? w[w.length - 1].weight_kg : null
    const inj = onDay(data.injections, 'injected_at', day)
    const meals = onDay(data.meals, 'eaten_at', day)
    const water = onDay(data.water, 'logged_at', day)
    const acts = onDay(data.activities, 'started_at', day)
    const syms = onDay(data.symptoms, 'occurred_at', day)
    const medl = onDay(data.medicationLogs, 'taken_at', day)
    return {
      day,
      isAppt: sameDay(day, apptDate),
      weight: lastW,
      bmi: hasBMI && lastW != null ? lastW / Math.pow(height / 100, 2) : null,
      dose: inj.length ? inj.reduce((a, r) => a + (Number(r.dose_mg) || 0), 0) : null,
      injected: inj.length > 0,
      calories: meals.length ? sum(meals, 'calories') : null,
      protein: meals.length ? sum(meals, 'protein_g') : null,
      mealCount: meals.length,
      water: water.length ? sum(water, 'amount_ml') : null,
      steps: acts.some((a) => a.steps != null) ? sum(acts, 'steps') : null,
      activeMin: acts.length ? sum(acts, 'duration_min') : null,
      seCount: syms.length,
      seMax: syms.length ? Math.max(...syms.map((s) => Number(s.severity) || 0)) : 0,
      meds: medl.length,
    }
  })

  /* ================= top-line metrics ================= */
  const weightsSorted = [...data.weights].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const firstW = weightsSorted[0]?.weight_kg
  const lastW = weightsSorted[weightsSorted.length - 1]?.weight_kg
  const baseW = data.prevWeight ?? firstW
  const deltaW = lastW != null && baseW != null ? lastW - baseW : null
  const pctW = deltaW != null && baseW ? (deltaW / baseW) * 100 : null
  const bmiNow = hasBMI && lastW != null ? lastW / Math.pow(height / 100, 2) : null

  const stepVals = daily.filter((d) => d.steps != null)
  const avgSteps = stepVals.length ? Math.round(stepVals.reduce((a, d) => a + d.steps, 0) / stepVals.length) : null
  const totalWater = data.water.reduce((a, w) => a + (w.amount_ml || 0), 0)
  const avgWaterL = totalWater ? totalWater / 1000 / 7 : null
  const totalActive = daily.reduce((a, d) => a + (d.activeMin || 0), 0)
  const seTotal = data.symptoms.length
  const sePeak = seTotal ? Math.max(...data.symptoms.map((s) => Number(s.severity) || 0)) : 0
  const daysLogged = daily.filter((d) =>
    d.weight != null || d.injected || d.mealCount || d.water != null || d.steps != null || d.activeMin != null || d.seCount
  ).length

  /* ================= header band ================= */
  doc.setFillColor(...INK)
  doc.rect(0, 0, pageW, 110, 'F')
  doc.setFillColor(...GREEN)
  doc.rect(0, 106, pageW, 4, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('Weekly Clinical Summary', margin, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(196, 220, 211)
  doc.text(profile?.full_name || 'Patient', margin, 60)
  // demographics line
  const demo = []
  if (profile?.dob) {
    const age = Math.floor((Date.now() - new Date(profile.dob)) / (365.25 * 864e5))
    if (age > 0 && age < 130) demo.push(`${age} yrs`)
  }
  if (profile?.sex) demo.push(profile.sex)
  if (height) demo.push(`${height} cm`)
  if (bmiNow) demo.push(`BMI ${bmiNow.toFixed(1)}`)
  if (demo.length) doc.text(demo.join('  ·  '), margin, 75)
  doc.text(`${fmtDateLong(window.start)}  to  ${fmtDateLong(window.end)}`, margin, demo.length ? 90 : 76)

  const rx = pageW - margin
  doc.setFontSize(9)
  doc.text(`Appointment  ${fmtDateLong(appointment.appointment_date)}`, rx, 52, { align: 'right' })
  if (appointment?.clinician) doc.text(`Clinician  ${appointment.clinician}`, rx, 66, { align: 'right' })
  if (profile?.glp1_drug) doc.text(`GLP-1  ${profile.glp1_drug}`, rx, 80, { align: 'right' })
  doc.text(`Days with data  ${daysLogged} / 7`, rx, 94, { align: 'right' })

  y = 130

  /* ================= KPI band ================= */
  const kpis = [
    { label: 'WEIGHT NOW', value: lastW != null ? `${lastW.toFixed(1)} kg` : '—',
      sub: deltaW != null ? `${deltaW > 0 ? '+' : ''}${deltaW.toFixed(1)} kg${pctW != null ? ` (${pctW > 0 ? '+' : ''}${pctW.toFixed(1)}%)` : ''}` : null,
      subTone: deltaW == null ? MUTED : deltaW <= 0 ? GREEN : BLOOM },
    hasBMI
      ? { label: 'BMI', value: bmiNow != null ? bmiNow.toFixed(1) : '—', sub: bmiNow != null ? bmiBand(bmiNow) : null, subTone: MUTED }
      : { label: 'ACTIVE TOTAL', value: `${Math.round(totalActive)} min`, sub: 'this cycle', subTone: MUTED },
    { label: 'INJECTION', value: data.injections.length ? 'Given' : 'Missed',
      sub: data.injections.length ? `${data.injections.length} logged` : 'none recorded',
      subTone: data.injections.length ? GREEN : BLOOM },
    { label: 'AVG STEPS', value: avgSteps != null ? avgSteps.toLocaleString() : '—', sub: 'per active day', subTone: MUTED },
    { label: 'AVG WATER', value: avgWaterL != null ? `${avgWaterL.toFixed(1)} L` : '—', sub: 'per day', subTone: MUTED },
    { label: 'SIDE EFFECTS', value: String(seTotal), sub: seTotal ? `peak severity ${sePeak}/5` : 'none reported',
      subTone: seTotal ? (sePeak >= 4 ? BLOOM : AMBER) : GREEN },
  ]
  const gap = 8
  const kw = (contentW - gap * 5) / 6
  const kh = 60
  kpis.forEach((c, i) => {
    const x = margin + i * (kw + gap)
    doc.setDrawColor(...LINE); doc.setFillColor(...SOFT)
    doc.roundedRect(x, y, kw, kh, 5, 5, 'FD')
    doc.setFillColor(...GREEN); doc.rect(x, y + 6, 2.5, kh - 12, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(...MUTED)
    doc.text(c.label, x + 9, y + 16)
    doc.setFontSize(13.5); doc.setTextColor(...INK)
    doc.text(String(c.value), x + 9, y + 36)
    if (c.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...(c.subTone || MUTED)); doc.text(c.sub, x + 9, y + 50) }
  })
  y += kh + 18

  /* ================= weight trend ================= */
  const pts = []
  if (data.prevWeight != null) pts.push({ v: data.prevWeight })
  weightsSorted.forEach((w) => pts.push({ v: w.weight_kg }))
  const tH = 116
  doc.setDrawColor(...LINE); doc.setFillColor(255, 255, 255)
  doc.roundedRect(margin, y, contentW, tH, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...GREEN_DEEP)
  doc.text('WEIGHT TREND', margin + 14, y + 18)
  if (pts.length >= 2) {
    const plot = { x: margin + 46, y: y + 26, w: contentW - 72, h: tH - 48 }
    const vals = pts.map((p) => p.v)
    const mn = Math.min(...vals) - 0.4, mx = Math.max(...vals) + 0.4
    const px = (i) => plot.x + (i / (pts.length - 1)) * plot.w
    const py = (v) => plot.y + (1 - (v - mn) / (mx - mn || 1)) * plot.h
    // baseline (start weight) reference
    doc.setDrawColor(...FAINT); doc.setLineWidth(0.7); doc.setLineDashPattern([2, 2], 0)
    doc.line(plot.x, py(pts[0].v), plot.x + plot.w, py(pts[0].v))
    doc.setLineDashPattern([], 0)
    // frame
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5)
    doc.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED)
    doc.text(mx.toFixed(1), margin + 14, plot.y + 4)
    doc.text(mn.toFixed(1), margin + 14, plot.y + plot.h + 3)
    // line
    doc.setDrawColor(...GREEN); doc.setLineWidth(1.8)
    for (let i = 1; i < pts.length; i++) doc.line(px(i - 1), py(pts[i - 1].v), px(i), py(pts[i].v))
    // dots + endpoints
    pts.forEach((p, i) => {
      const last = i === pts.length - 1
      doc.setFillColor(...(last ? GREEN : WHITE)); doc.setDrawColor(...GREEN); doc.setLineWidth(1.2)
      doc.circle(px(i), py(p.v), last ? 2.6 : 1.7, last ? 'F' : 'FD')
    })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
    doc.text(pts[0].v.toFixed(1), px(0), py(pts[0].v) - 6, { align: 'center' })
    doc.text(pts[pts.length - 1].v.toFixed(1), px(pts.length - 1), py(pts[pts.length - 1].v) - 6, { align: 'center' })
    doc.setLineWidth(1)
  } else {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...MUTED)
    doc.text('Not enough weight readings this cycle to chart a trend.', margin + 14, y + tH / 2 + 4)
  }
  y += tH + 20

  /* ================= DAILY FLOWSHEET (centerpiece) ================= */
  sectionLabel(doc, 'DAILY FLOWSHEET', margin, pageW, y, GREEN_DEEP)
  y += 14

  const dayHead = ['Parameter', ...daily.map((d) =>
    `${d.day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}\n${d.day.getDate()}/${d.day.getMonth() + 1}`
  )]

  // row definitions: label + value formatter (+ optional per-cell styler)
  const dash = '·'
  const rows = [
    { label: 'Weight (kg)', get: (d) => (d.weight != null ? d.weight.toFixed(1) : dash), bold: true },
    ...(hasBMI ? [{ label: 'BMI', get: (d) => (d.bmi != null ? d.bmi.toFixed(1) : dash) }] : []),
    { label: 'GLP-1 dose (mg)', get: (d) => (d.injected ? (d.dose ? d.dose.toFixed(2) : 'given') : dash), kind: 'inj' },
    { label: 'Calories (kcal)', get: (d) => (d.calories ? Math.round(d.calories).toLocaleString() : dash) },
    { label: 'Protein (g)', get: (d) => (d.protein ? Math.round(d.protein) : dash) },
    { label: 'Meals (n)', get: (d) => (d.mealCount ? d.mealCount : dash) },
    { label: 'Water (L)', get: (d) => (d.water ? (d.water / 1000).toFixed(1) : dash) },
    { label: 'Steps', get: (d) => (d.steps != null ? d.steps.toLocaleString() : dash) },
    { label: 'Active (min)', get: (d) => (d.activeMin ? Math.round(d.activeMin) : dash) },
    { label: 'Side effects', get: (d) => (d.seCount ? `${d.seCount}${d.seMax ? ` · S${d.seMax}` : ''}` : dash), kind: 'se' },
    { label: 'Meds taken', get: (d) => (d.meds ? d.meds : dash) },
  ]

  const body = rows.map((r) => [r.label, ...daily.map((d) => String(r.get(d)))])

  autoTable(doc, {
    startY: y,
    head: [dayHead],
    body,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }, textColor: INK, lineColor: LINE, lineWidth: 0.5, halign: 'center', valign: 'middle' },
    headStyles: { fillColor: INK, textColor: 255, fontSize: 7.5, fontStyle: 'bold', halign: 'center', valign: 'middle', minCellHeight: 24 },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold', fillColor: SOFT, textColor: INK, cellWidth: 96 } },
    didParseCell: (hook) => {
      const ci = hook.column.index
      if (hook.section === 'head') {
        if (ci >= 1 && daily[ci - 1].isAppt) { hook.cell.styles.fillColor = BLOOM; hook.cell.styles.textColor = 255 }
        return
      }
      if (ci === 0) return
      const r = rows[hook.row.index]
      const d = daily[ci - 1]
      const empty = hook.cell.text.join('') === dash
      if (empty) { hook.cell.styles.textColor = FAINT; return }
      if (r.kind === 'inj') { hook.cell.styles.fillColor = BLOOM_SOFT; hook.cell.styles.textColor = BLOOM_DEEP; hook.cell.styles.fontStyle = 'bold' }
      else if (r.kind === 'se' && d.seCount) { hook.cell.styles.fillColor = sevFill(d.seMax || 1); hook.cell.styles.textColor = sevText(d.seMax || 1); hook.cell.styles.fontStyle = 'bold' }
      else if (r.bold) hook.cell.styles.fontStyle = 'bold'
    },
    didDrawCell: (hook) => {
      // mark the appointment-day column body cells with a faint coral edge
      if (hook.section === 'body' && hook.column.index >= 1 && daily[hook.column.index - 1].isAppt) {
        doc.setDrawColor(...BLOOM); doc.setLineWidth(0.8)
        doc.line(hook.cell.x, hook.cell.y, hook.cell.x, hook.cell.y + hook.cell.height)
        doc.line(hook.cell.x + hook.cell.width, hook.cell.y, hook.cell.x + hook.cell.width, hook.cell.y + hook.cell.height)
        doc.setLineWidth(0.5)
      }
    },
  })
  y = doc.lastAutoTable.finalY + 8

  // legend
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED)
  doc.text('Coral column = appointment day   ·   GLP-1 cells shaded coral   ·   Side-effect cells shaded by peak severity (S1–S5)   ·   ·  = not recorded', margin, y + 4)
  y += 20

  /* ================= detail logs (date-wise) ================= */
  function table(title, head, rowsArr, opts = {}, tone = GREEN_DEEP, headFill = INK) {
    if (y > pageH - 110) { doc.addPage(); y = 46 }
    sectionLabel(doc, title, margin, pageW, y, tone)
    y += 12
    autoTable(doc, {
      startY: y,
      head: [head],
      body: rowsArr.length ? rowsArr : [[{ content: 'No entries this cycle', colSpan: head.length, styles: { textColor: MUTED, fontStyle: 'italic', halign: 'left' } }]],
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: headFill, textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: SOFT },
      ...opts,
    })
    y = doc.lastAutoTable.finalY + 18
  }

  table('GLP-1 injections', ['When', 'Drug', 'Dose (mg)', 'Site', 'Lot', 'Notes'],
    data.injections.map((i) => [fmtTime(i.injected_at), i.drug || '—', fx(i.dose_mg, 2), i.site || '—', i.lot || '—', i.notes || '']),
    {}, BLOOM_DEEP, BLOOM)

  table('Side effects & symptoms', ['When', 'Type', 'Severity', 'Notes'],
    data.symptoms.map((s) => [fmtTime(s.occurred_at), s.type, s.severity ? `${s.severity}/5` : '—', s.notes || '']),
    { columnStyles: { 2: { halign: 'center' } },
      didParseCell: (hook) => {
        if (hook.section === 'body' && hook.column.index === 2) {
          const m = String(hook.cell.text.join('')).match(/(\d)/)
          if (m) { hook.cell.styles.fillColor = sevFill(+m[1]); hook.cell.styles.textColor = sevText(+m[1]); hook.cell.styles.fontStyle = 'bold' }
        }
      } }, BLOOM_DEEP, BLOOM)

  table('Weight readings', ['When', 'Weight (kg)', 'Source'],
    weightsSorted.map((w) => [fmtTime(w.logged_at), fx(w.weight_kg, 1), w.source || 'manual']))

  table('Activity & movement', ['When', 'Type', 'Duration (min)', 'Distance (km)', 'Steps', 'Energy (kcal)'],
    [...data.activities].sort((a, b) => new Date(a.started_at) - new Date(b.started_at)).map((a) => [
      fmtTime(a.started_at), a.type, fx(a.duration_min, 0), fx(a.distance_km, 2),
      a.steps != null ? a.steps.toLocaleString() : '—', fx(a.energy_kcal, 0)]))

  table('Food & nutrition', ['When', 'Meal', 'What was eaten', 'Calories', 'Protein (g)'],
    [...data.meals].sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at)).map((m) => [
      fmtTime(m.eaten_at), m.meal_type, m.description || m.notes || '—', fx(m.calories), fx(m.protein_g)]),
    { columnStyles: { 2: { cellWidth: 150 } } })

  const waterByDay = {}
  data.water.forEach((w) => { const d = fmtDate(w.logged_at); waterByDay[d] = (waterByDay[d] || 0) + (w.amount_ml || 0) })
  table('Hydration by day', ['Day', 'Total water (ml)', 'Litres'],
    Object.entries(waterByDay).map(([d, ml]) => [d, Math.round(ml).toLocaleString(), (ml / 1000).toFixed(2)]))

  const medName = {}
  ;(data.medications || []).forEach((m) => (medName[m.id] = m.name))
  table('Medications taken', ['When', 'Medication'],
    (data.medicationLogs || []).map((l) => [fmtTime(l.taken_at), medName[l.medication_id] || '—']))

  /* ================= footer ================= */
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5)
    doc.line(margin, pageH - 32, pageW - margin, pageH - 32)
    doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal')
    doc.text(`${profile?.full_name || 'Patient'} · Generated ${new Date().toLocaleDateString()} · Self-recorded data, for clinical review`, margin, pageH - 18)
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 18, { align: 'right' })
  }

  doc.save(`health-report-${fmtDate(window.end).replace(/[ ,]/g, '-')}.pdf`)
}

/* ---------- helpers ---------- */
function fx(v, d = 0) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  return Number(v).toFixed(d)
}
function bmiBand(b) {
  if (b < 18.5) return 'underweight'
  if (b < 25) return 'normal range'
  if (b < 30) return 'overweight'
  return 'obese range'
}
function sectionLabel(doc, text, margin, pageW, y, tone) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...tone)
  doc.text(text.toUpperCase(), margin, y)
  doc.setDrawColor(...tone); doc.setLineWidth(1.3)
  doc.line(margin, y + 4, margin + 26, y + 4)
  doc.setDrawColor(...LINE); doc.setLineWidth(0.5)
  doc.line(margin + 30, y + 4, pageW - margin, y + 4)
}
