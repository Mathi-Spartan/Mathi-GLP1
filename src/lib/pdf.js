import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmtDateLong, fmtDate } from './week.js'

// Brand colours (matched to the app)
const INK = [21, 48, 43]
const GREEN = [14, 124, 90]
const AMBER = [180, 83, 9]
const MUTED = [91, 107, 100]
const LINE = [226, 232, 227]

function fmtTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function num(v, digits = 0) {
  if (v === null || v === undefined || isNaN(v)) return '—'
  return Number(v).toFixed(digits)
}

// data = { weights, injections, meals, water, activities, medications,
//          medicationLogs, symptoms, prevWeight }
export function generateWeeklyPDF({ profile, appointment, window, data }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  let y = 0

  // ---------- header band ----------
  doc.setFillColor(...INK)
  doc.rect(0, 0, pageW, 96, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('Weekly health report', margin, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(200, 222, 214)
  const name = profile?.full_name || 'Patient'
  doc.text(name, margin, 60)
  const range = `${fmtDateLong(window.start)}  →  ${fmtDateLong(window.end)}`
  doc.text(range, margin, 76)
  if (appointment?.clinician) {
    doc.text(`Clinician: ${appointment.clinician}`, pageW - margin, 60, { align: 'right' })
  }
  doc.text(`Appointment: ${fmtDateLong(appointment.appointment_date)}`, pageW - margin, 76, {
    align: 'right',
  })

  y = 124

  // ---------- summary metrics ----------
  const weights = [...data.weights].sort(
    (a, b) => new Date(a.logged_at) - new Date(b.logged_at)
  )
  const firstW = weights[0]?.weight_kg
  const lastW = weights[weights.length - 1]?.weight_kg
  const baseW = data.prevWeight ?? firstW
  let change = '—'
  if (lastW != null && baseW != null) {
    const d = lastW - baseW
    change = `${d > 0 ? '+' : ''}${d.toFixed(1)} kg`
  }
  const stepDays = data.activities.filter((a) => a.steps != null)
  const avgSteps = stepDays.length
    ? Math.round(stepDays.reduce((s, a) => s + a.steps, 0) / stepDays.length)
    : null
  const totalWater = data.water.reduce((s, w) => s + (w.amount_ml || 0), 0)
  const injectionGiven = data.injections.length > 0
  const symptomCount = data.symptoms.length

  const cards = [
    { label: 'Weight now', value: lastW != null ? `${num(lastW, 1)} kg` : '—' },
    { label: 'Change this week', value: change },
    { label: 'Injection', value: injectionGiven ? 'Given' : 'Not logged' },
    { label: 'Avg steps/day', value: avgSteps != null ? avgSteps.toLocaleString() : '—' },
    { label: 'Water total', value: totalWater ? `${(totalWater / 1000).toFixed(1)} L` : '—' },
    { label: 'Side effects', value: String(symptomCount) },
  ]
  const cardW = (pageW - margin * 2 - 10 * 5) / 6
  cards.forEach((c, i) => {
    const x = margin + i * (cardW + 10)
    doc.setDrawColor(...LINE)
    doc.setFillColor(248, 250, 248)
    doc.roundedRect(x, y, cardW, 56, 4, 4, 'FD')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.text(c.label.toUpperCase(), x + 8, y + 18)
    doc.setFontSize(12)
    doc.setTextColor(...INK)
    doc.setFont('helvetica', 'bold')
    doc.text(String(c.value), x + 8, y + 40)
  })
  y += 56 + 24

  // ---------- helper to draw a section heading ----------
  function heading(text) {
    if (y > doc.internal.pageSize.getHeight() - 90) {
      doc.addPage()
      y = 48
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...GREEN)
    doc.text(text, margin, y)
    y += 8
    doc.setDrawColor(...LINE)
    doc.line(margin, y, pageW - margin, y)
    y += 8
  }

  function table(head, body, opts = {}) {
    autoTable(doc, {
      startY: y,
      head: [head],
      body: body.length ? body : [[{ content: 'No entries this week', colSpan: head.length, styles: { textColor: MUTED, fontStyle: 'italic' } }]],
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: INK, textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 248] },
      ...opts,
    })
    y = doc.lastAutoTable.finalY + 22
  }

  // ---------- injections ----------
  heading('GLP-1 injection')
  table(
    ['When', 'Drug', 'Dose (mg)', 'Site', 'Lot', 'Notes'],
    data.injections.map((i) => [
      fmtTime(i.injected_at),
      i.drug || '—',
      num(i.dose_mg, 2),
      i.site || '—',
      i.lot || '—',
      i.notes || '',
    ])
  )

  // ---------- side effects ----------
  heading('Side effects & symptoms')
  table(
    ['When', 'Type', 'Severity (1-5)', 'Notes'],
    data.symptoms.map((s) => [fmtTime(s.occurred_at), s.type, num(s.severity), s.notes || '']),
    { columnStyles: { 2: { halign: 'center' } } }
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
    [...data.activities]
      .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
      .map((a) => [
        fmtTime(a.started_at),
        a.type,
        num(a.duration_min, 0),
        num(a.distance_km, 2),
        a.steps != null ? a.steps.toLocaleString() : '—',
        num(a.energy_kcal, 0),
      ])
  )

  // ---------- meals ----------
  heading('Food & nutrition')
  table(
    ['When', 'Meal', 'What was eaten', 'Calories', 'Protein (g)'],
    [...data.meals]
      .sort((a, b) => new Date(a.eaten_at) - new Date(b.eaten_at))
      .map((m) => [
        fmtTime(m.eaten_at),
        m.meal_type,
        m.description || m.notes || '—',
        num(m.calories),
        num(m.protein_g),
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
    const h = doc.internal.pageSize.getHeight()
    doc.setDrawColor(...LINE)
    doc.line(margin, h - 34, pageW - margin, h - 34)
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Generated ${new Date().toLocaleString()} · Self-recorded patient data, for clinical review`,
      margin,
      h - 20
    )
    doc.text(`Page ${p} of ${pages}`, pageW - margin, h - 20, { align: 'right' })
  }

  const fileName = `health-report-${fmtDate(window.end).replace(/[ ,]/g, '-')}.pdf`
  doc.save(fileName)
}
