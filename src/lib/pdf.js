import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateLong, fmtDate } from './week.js'

// Brand colours (matched to the refreshed app)
const INK = [17, 37, 32]
const GREEN = [14, 122, 92]
const GREEN_DEEP = [10, 93, 70]
const BLOOM = [200, 71, 47]
const MUTED = [98, 117, 109]
const LINE = [224, 233, 228]
const SOFT = [246, 250, 248]
const GREEN_SOFT = [223, 240, 233]

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}
function num(v, digits = 0) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  return Number(v).toFixed(digits)
}

export function generateWeeklyPDF({ profile, appointment, window, data }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const contentW = pageW - margin * 2
  let y = 0

  // ---------- derived summary ----------
  const weights = [...data.weights].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const firstW = weights[0]?.weight_kg
  const lastW = weights[weights.length - 1]?.weight_kg
  const baseW = data.prevWeight ?? firstW
  let changeNum = null
  if (lastW != null && baseW != null) changeNum = lastW - baseW
  const change = changeNum == null ? '—' : `${changeNum > 0 ? '+' : ''}${changeNum.toFixed(1)} kg`
  const stepDays = data.activities.filter((a) => a.steps != null)
  const avgSteps = stepDays.length
    ? Math.round(stepDays.reduce((s, a) => s + a.steps, 0) / stepDays.length) : null
  const totalWater = data.water.reduce((s, w) => s + (w.amount_ml || 0), 0)
  const injectionGiven = data.injections.length > 0
  const symptomCount = data.symptoms.length

  // ---------- header band ----------
  doc.setFillColor(...INK)
  doc.rect(0, 0, pageW, 104, 'F')
  doc.setFillColor(...GREEN)
  doc.rect(0, 100, pageW, 4, 'F') // accent rule
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text('Weekly Health Report', margin, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(200, 222, 214)
  doc.text(profile?.full_name || 'Patient', margin, 62)
  doc.text(`${fmtDateLong(window.start)}  →  ${fmtDateLong(window.end)}`, margin, 78)

  // right column
  const rx = pageW - margin
  doc.setFontSize(9)
  doc.text(`Appointment: ${fmtDateLong(appointment.appointment_date)}`, rx, 50, { align: 'right' })
  if (appointment?.clinician) doc.text(`Clinician: ${appointment.clinician}`, rx, 64, { align: 'right' })
  if (profile?.glp1_drug) doc.text(`Medication: ${profile.glp1_drug}`, rx, 78, { align: 'right' })

  y = 124

  // ---------- at-a-glance sentence ----------
  const glance = []
  if (changeNum != null) glance.push(`Weight ${changeNum <= 0 ? 'down' : 'up'} ${Math.abs(changeNum).toFixed(1)} kg`)
  glance.push(injectionGiven ? `${data.injections.length} injection${data.injections.length > 1 ? 's' : ''} logged` : 'no injection logged')
  glance.push(`${symptomCount} side effect${symptomCount === 1 ? '' : 's'}`)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK)
  doc.text(glance.join('   ·   '), margin, y)
  y += 18

  // ---------- summary chips ----------
  const chips = [
    { label: 'WEIGHT NOW', value: lastW != null ? `${num(lastW, 1)} kg` : '—' },
    { label: 'CHANGE', value: change, tone: changeNum == null ? null : changeNum <= 0 ? GREEN : BLOOM },
    { label: 'INJECTION', value: injectionGiven ? 'Given' : 'Not logged', tone: injectionGiven ? GREEN : MUTED },
    { label: 'AVG STEPS/DAY', value: avgSteps != null ? avgSteps.toLocaleString() : '—' },
    { label: 'WATER', value: totalWater ? `${(totalWater / 1000).toFixed(1)} L` : '—' },
    { label: 'SIDE EFFECTS', value: String(symptomCount), tone: symptomCount > 0 ? BLOOM : GREEN },
  ]
  const gap = 9
  const chipW = (contentW - gap * 5) / 6
  chips.forEach((c, i) => {
    const x = margin + i * (chipW + gap)
    doc.setDrawColor(...LINE)
    doc.setFillColor(...SOFT)
    doc.roundedRect(x, y, chipW, 58, 5, 5, 'FD')
    doc.setFontSize(6.5)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'bold')
    doc.text(c.label, x + 8, y + 17)
    doc.setFontSize(12.5)
    doc.setTextColor(...(c.tone || INK))
    doc.text(String(c.value), x + 8, y + 40)
  })
  y += 58 + 22

  // ---------- weight trend sparkline ----------
  const pts = []
  if (data.prevWeight != null) pts.push({ v: data.prevWeight, baseline: true })
  weights.forEach((w) => pts.push({ v: w.weight_kg }))

  const cardH = 132
  doc.setDrawColor(...LINE)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(margin, y, contentW, cardH, 6, 6, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...GREEN_DEEP)
  doc.text('WEIGHT TREND', margin + 14, y + 20)

  if (pts.length >= 2) {
    const plot = { x: margin + 44, y: y + 30, w: contentW - 70, h: cardH - 56 }
    const vals = pts.map((p) => p.v)
    const mn = Math.min(...vals) - 0.4
    const mx = Math.max(...vals) + 0.4
    const px = (i) => plot.x + (i / (pts.length - 1)) * plot.w
    const py = (v) => plot.y + (1 - (v - mn) / (mx - mn || 1)) * plot.h

    // gridlines + axis labels
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(plot.x, plot.y, plot.x + plot.w, plot.y)
    doc.line(plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h)
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.text(`${mx.toFixed(1)}`, margin + 14, plot.y + 4)
    doc.text(`${mn.toFixed(1)}`, margin + 14, plot.y + plot.h + 3)

    // line
    doc.setDrawColor(...GREEN)
    doc.setLineWidth(1.8)
    for (let i = 1; i < pts.length; i++) {
      doc.line(px(i - 1), py(pts[i - 1].v), px(i), py(pts[i].v))
    }
    // dots
    pts.forEach((p, i) => {
      const last = i === pts.length - 1
      doc.setFillColor(...(last ? GREEN : [255, 255, 255]))
      doc.setDrawColor(...GREEN)
      doc.setLineWidth(1.2)
      doc.circle(px(i), py(p.v), last ? 2.6 : 1.8, last ? 'F' : 'FD')
    })
    // endpoint labels
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...INK)
    doc.text(`${pts[0].v.toFixed(1)}`, px(0), py(pts[0].v) - 6, { align: 'center' })
    doc.text(`${pts[pts.length - 1].v.toFixed(1)}`, px(pts.length - 1), py(pts[pts.length - 1].v) - 6, { align: 'center' })
    doc.setLineWidth(1)
  } else {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text('Not enough weight readings this cycle to chart a trend.', margin + 14, y + cardH / 2 + 4)
  }
  y += cardH + 22

  // ---------- section helpers ----------
  function heading(text, tone = GREEN_DEEP) {
    if (y > pageH - 96) { doc.addPage(); y = 50 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...tone)
    doc.text(text.toUpperCase(), margin, y)
    y += 7
    doc.setDrawColor(...tone)
    doc.setLineWidth(1.2)
    doc.line(margin, y, margin + 26, y)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(margin + 30, y, pageW - margin, y)
    y += 10
  }

  function table(head, body, opts = {}, headFill = INK) {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.length ? body : [[{ content: 'No entries this cycle', colSpan: head.length, styles: { textColor: MUTED, fontStyle: 'italic' } }]],
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: headFill, textColor: 255, fontSize: 7.5, fontStyle: 'bold', cellPadding: 5 },
      alternateRowStyles: { fillColor: SOFT },
      ...opts,
    })
    y = doc.lastAutoTable.finalY + 20
  }

  // ---------- injection (clinically key → coral) ----------
  heading('GLP-1 injection', BLOOM)
  table(
    ['When', 'Drug', 'Dose (mg)', 'Site', 'Lot', 'Notes'],
    data.injections.map((i) => [fmtTime(i.injected_at), i.drug || '—', num(i.dose_mg, 2), i.site || '—', i.lot || '—', i.notes || '']),
    {}, BLOOM
  )

  // ---------- side effects (clinically key → coral) ----------
  heading('Side effects & symptoms', BLOOM)
  table(
    ['When', 'Type', 'Severity (1-5)', 'Notes'],
    data.symptoms.map((s) => [fmtTime(s.occurred_at), s.type, num(s.severity), s.notes || '']),
    { columnStyles: { 2: { halign: 'center' } } }, BLOOM
  )

  // ---------- weight ----------
  heading('Weight')
  table(
    ['When', 'Weight (kg)', 'Source'],
    weights.map((w) => [fmtTime(w.logged_at), num(w.weight_kg, 1), w.source || 'manual'])
  )

  // ---------- activity ----------
  heading('Activity & movement')
  table(
    ['When', 'Type', 'Duration (min)', 'Distance (km)', 'Steps', 'Energy (kcal)'],
    [...data.activities].sort((a, b) => new Date(a.started_at) - new Date(b.started_at)).map((a) => [
      fmtTime(a.started_at), a.type, num(a.duration_min, 0), num(a.distance_km, 2),
      a.steps != null ? a.steps.toLocaleString() : '—', num(a.energy_kcal, 0),
    ])
  )

  // ---------- meals ----------
  heading('Food & nutrition')
  table(
    ['When', 'Meal', 'What was eaten', 'Calories', 'Protein (g)'],
    [...data.meals].sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at)).map((m) => [
      fmtTime(m.eaten_at), m.meal_type, m.description || m.notes || '—', num(m.calories), num(m.protein_g),
    ]),
    { columnStyles: { 2: { cellWidth: 150 } } }
  )

  // ---------- hydration ----------
  heading('Hydration')
  const waterByDay = {}
  data.water.forEach((w) => {
    const d = fmtDate(w.logged_at)
    waterByDay[d] = (waterByDay[d] || 0) + (w.amount_ml || 0)
  })
  table(
    ['Day', 'Total water (ml)'],
    Object.entries(waterByDay).map(([d, ml]) => [d, Math.round(ml).toLocaleString()])
  )

  // ---------- medications ----------
  heading('Medications taken')
  const medName = {}
  ;(data.medications || []).forEach((m) => (medName[m.id] = m.name))
  table(
    ['When', 'Medication'],
    (data.medicationLogs || []).map((l) => [fmtTime(l.taken_at), medName[l.medication_id] || '—'])
  )

  // ---------- footer on every page ----------
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setDrawColor(...LINE)
    doc.setLineWidth(0.5)
    doc.line(margin, pageH - 34, pageW - margin, pageH - 34)
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.text(`Generated ${new Date().toLocaleString()} · Self-recorded patient data, for clinical review`, margin, pageH - 20)
    doc.text(`Page ${p} of ${pages}`, pageW - margin, pageH - 20, { align: 'right' })
  }

  const fileName = `health-report-${fmtDate(window.end).replace(/[ ,]/g, '-')}.pdf`
  doc.save(fileName)
}
