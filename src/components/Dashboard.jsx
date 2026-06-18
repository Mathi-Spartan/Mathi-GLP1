import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { LogModal } from './LogForms.jsx'
import { buildReportDoc } from '../lib/pdf.js'
import { parseAppleHealthExport } from '../lib/appleHealth.js'
import { nextTuesday, reportWindow, weekDays, weekWindowsBack, sameDay, fmtDate, toISODate } from '../lib/week.js'

// ── icons ────────────────────────────────────────────────────────────────────
function Ic({ d, size = 22, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  )
}
const I = {
  weight:    'M12 3a2 2 0 0 1 1.9 1.4H19a2 2 0 0 1 2 2v.2L18.5 17a3 3 0 0 1-5.9 0L10 6.6V6.4A2 2 0 0 1 5 6.4H10.1A2 2 0 0 1 12 3ZM5 6.4 2.5 17a3 3 0 0 0 5.9 0L6 6.4',
  injection: 'm18 2 4 4M17 3l4 4-9.5 9.5-4.5 1 1-4.5L17 3ZM10.5 9.5l4 4M3 21l4-4',
  meal:      'M5 2v8m3-8v8M6.5 2v8M6.5 14v8M18 2c-1.5 1-2 3-2 6s.5 4 2 5v9',
  water:     'M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z',
  activity:  'M4 13h3l2.5-7 4 14 2.5-7H20',
  symptom:   'M3 12h4l2-5 3 9 2-4h7',
  craving:   'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z',
  sleep:     'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  mood:      'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2ZM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  gear:      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.2-1.3L15.3 2h-4l-.5 2.5a8 8 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.2 1.3l.5 2.5h4l.5-2.5a8 8 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z',
  out:       'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  report:    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h6',
  chart:     'M3 3v18h18M18 9l-5 5-4-4-3 3',
  pill:      'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7l-6 6ZM8 8l8 8',
  barbell:   'M6 5v14M18 5v14M2 9h4M18 9h4M2 15h4M18 15h4M6 9h12M6 15h12',
  protein:   'M3 2l3 3-3 3M9 2l3 3-3 3M21 12H3M12 21V3',
  home:      'M3 11l9-8 9 8M5 10v10h14V10',
  trend:     'M3 17l6-6 4 4 8-8M21 7h-6v6',
  plus:      'M12 5v14M5 12h14',
  user:      'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  bolt:      'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  chevR:     'M9 18l6-6-6-6',
}

const QUICK = [
  { type: 'weight',    d: I.weight,    label: 'Weight',     bg: '#e1f5ee', fg: '#0f6e56' },
  { type: 'injection', d: I.injection, label: 'Dose',        bg: '#e6f1fb', fg: '#185fa5' },
  { type: 'meal',      d: I.meal,      label: 'Food',        bg: '#faece7', fg: '#993c1d' },
  { type: 'craving',   d: I.craving,   label: 'Craving',     bg: '#faeeda', fg: '#854f0b' },
  { type: 'water',     d: I.water,     label: 'Water',       bg: '#e6f1fb', fg: '#0c447c' },
  { type: 'activity',  d: I.activity,  label: 'Activity',    bg: '#eaf3de', fg: '#3b6d11' },
  { type: 'symptom',   d: I.symptom,   label: 'Side effect', bg: '#fbeaf0', fg: '#993556' },
  { type: 'sleep',     d: I.sleep,     label: 'Sleep',        bg: '#eeedfe', fg: '#3c3489', isNew: true },
  { type: 'mood',      d: I.mood,      label: 'Mood',         bg: '#fbeaf0', fg: '#72243e', isNew: true },
]

// ── helpers ───────────────────────────────────────────────────────────────────
function ageFrom(dob) {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 864e5))
}
function ladderFor(drug) {
  const s = (drug || '').toLowerCase()
  if (s.includes('tirzep') || s.includes('mounjaro') || s.includes('zepbound'))
    return [2.5, 5, 7.5, 10, 12.5, 15]
  if (s.includes('semaglu') || s.includes('ozempic') || s.includes('wegovy'))
    return [0.25, 0.5, 1, 1.7, 2.4]
  if (s.includes('lira') || s.includes('saxenda'))
    return [0.6, 1.2, 1.8, 2.4, 3.0]
  return []
}
function n1(v) { return v != null && !isNaN(v) ? Number(v).toFixed(1) : '—' }
function pct(v, max) { return Math.min(100, Math.max(0, (v / max) * 100)) }

// ── health score ──────────────────────────────────────────────────────────────
function calcScore(data, profile) {
  let score = 0, total = 0
  const add = (pts, max) => { score += Math.min(pts, max); total += max }
  const weights = data.weights || []
  const lastW = weights.length ? Number(weights[weights.length - 1].weight_kg) : null
  const baseW = profile?.baseline_weight_kg
  if (lastW && baseW && lastW < baseW) add(15, 15)
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
  const avgSleep = (data.sleep || []).length
    ? (data.sleep || []).reduce((s, sl) => s + (Number(sl.hours) || 0), 0) / data.sleep.length : null
  add(avgSleep == null ? 5 : avgSleep >= 7 && avgSleep <= 9 ? 10 : avgSleep >= 6 ? 7 : 3, 10)
  const avgMood = (data.mood || []).length
    ? (data.mood || []).reduce((s, m) => s + (Number(m.score) || 0), 0) / data.mood.length : null
  add(avgMood == null ? 5 : avgMood >= 3 ? 10 : avgMood >= 2 ? 6 : 3, 10)
  add((data.injections || []).length > 0 ? 5 : 0, 5)
  return total ? Math.round((score / total) * 100) : 0
}

function computeWeekMetrics(weekData, profile) {
  const today = new Date()
  const weights = weekData.weights
  const lastW = weights.length ? Number(weights[weights.length - 1].weight_kg) : null
  const baseW = profile?.baseline_weight_kg ? Number(profile.baseline_weight_kg) : null
  const goalW = profile?.height_cm ? 24.9 * Math.pow(Number(profile.height_cm) / 100, 2) : null
  const lostTotal = baseW && lastW ? baseW - lastW : null
  const journeyPct = baseW && goalW && lastW ? Math.max(0, Math.min(100, ((baseW - lastW) / (baseW - goalW)) * 100)) : null
  const cycleStartW = weekData.prevWeight ?? (weights[0]?.weight_kg ? Number(weights[0].weight_kg) : null)
  const deltaW = lastW && cycleStartW ? lastW - cycleStartW : null

  const sideFx = (weekData.symptoms || []).filter(s => s.type?.toLowerCase() !== 'craving')
  const cravings = (weekData.symptoms || []).filter(s => s.type?.toLowerCase() === 'craving')
  const avgCraving = cravings.length ? cravings.reduce((a, c) => a + (Number(c.severity) || 0), 0) / cravings.length : null
  const cravingTrend = (() => {
    if (cravings.length < 2) return null
    const sorted = [...cravings].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at))
    const mid = Math.floor(sorted.length / 2)
    const avg = arr => arr.reduce((s, c) => s + (Number(c.severity) || 0), 0) / arr.length
    return avg(sorted.slice(mid)) - avg(sorted.slice(0, mid))
  })()
  const peakSev = sideFx.reduce((m, s) => Math.max(m, Number(s.severity) || 0), 0)
  const giClear = peakSev <= 2

  const inj = weekData.injections
  const lastInj = inj.length ? inj[inj.length - 1] : null
  const lastDose = lastInj?.dose_mg ? Number(lastInj.dose_mg) : null
  const lastDrug = lastInj?.drug || profile?.glp1_drug || ''
  const ladder = ladderFor(lastDrug)
  const curRung = ladder.findIndex(s => lastDose != null && Math.abs(s - lastDose) < 1e-6)
  const nextDose = curRung >= 0 && curRung < ladder.length - 1 ? ladder[curRung + 1] : null

  const spanDays = 7
  const totalProt = weekData.meals.reduce((s, m) => s + (Number(m.protein_g) || 0), 0)
  const protPerKg = lastW && totalProt ? (totalProt / spanDays / lastW) : null
  const totalWater = weekData.water.reduce((s, w) => s + (Number(w.amount_ml) || 0), 0)
  const avgWater = totalWater / spanDays / 1000
  const totalActiveMin = weekData.activities.reduce((s, a) => s + (Number(a.duration_min) || 0), 0)
  const resistanceMin = weekData.activities.filter(a => /strength|weight|resist|barbell/i.test(a.type || '')).reduce((s, a) => s + (Number(a.duration_min) || 0), 0)
  const avgSleep = weekData.sleep.length ? weekData.sleep.reduce((s, sl) => s + (Number(sl.hours) || 0), 0) / weekData.sleep.length : null
  const avgMood = weekData.mood.length ? weekData.mood.reduce((s, m) => s + (Number(m.score) || 0), 0) / weekData.mood.length : null
  const moodLabel = ['', 'Low', 'Okay', 'Good', 'Great', 'Best']

  const treatStart = profile?.treatment_start_date ? new Date(profile.treatment_start_date) : null
  const weekNum = treatStart ? Math.ceil((weekData.window.end - treatStart) / (7 * 24 * 60 * 60 * 1000)) : null
  const monthNum = treatStart ? Math.ceil((weekData.window.end - treatStart) / (30.5 * 24 * 60 * 60 * 1000)) : null

  function dayData(day) {
    const hits = { inj: false, weight: false, craving: false, side: false, activity: false, sleep: false, meal: false }
    weekData.injections.forEach(r => { if (sameDay(new Date(r.injected_at), day)) hits.inj = true })
    weekData.weights.forEach(r => { if (sameDay(new Date(r.logged_at), day)) hits.weight = true })
    weekData.symptoms.forEach(r => {
      if (sameDay(new Date(r.occurred_at), day)) {
        if (r.type === 'craving') hits.craving = true; else hits.side = true
      }
    })
    weekData.activities.forEach(r => { if (sameDay(new Date(r.started_at), day)) hits.activity = true })
    weekData.sleep.forEach(r => { if (sameDay(new Date(r.logged_at), day)) hits.sleep = true })
    weekData.meals.forEach(r => { if (sameDay(new Date(r.eaten_at), day)) hits.meal = true })
    return hits
  }

  const score = calcScore(weekData, profile)

  return {
    today, lastW, baseW, goalW, lostTotal, journeyPct, deltaW, sideFx, cravings, avgCraving, cravingTrend,
    giClear, lastInj, lastDose, lastDrug, ladder, curRung, nextDose, totalProt, protPerKg, totalWater, avgWater,
    totalActiveMin, resistanceMin, avgSleep, avgMood, moodLabel, weekNum, monthNum, dayData, score,
  }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function StatBar({ value, max, color = '#1d9e75' }) {
  const w = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div className="stat-bar">
      <div className="stat-bar-fill" style={{ width: `${w}%`, background: color }} />
    </div>
  )
}

function WeekSection({ weekData, profile, appointment, isLatest, setOpenLog }) {
  const m = computeWeekMetrics(weekData, profile)
  const {
    today, lastW, lostTotal, journeyPct, deltaW, sideFx, avgCraving, giClear,
    lastDose, ladder, curRung, totalProt, protPerKg, totalWater, avgWater,
    totalActiveMin, resistanceMin, avgSleep, avgMood, moodLabel, weekNum, monthNum, dayData, score,
  } = m
  const apptDate = new Date(appointment.appointment_date + 'T12:00:00')
  const daysToAppt = Math.ceil((apptDate - today) / (24 * 60 * 60 * 1000))
  const days = weekDays(weekData.window.end)

  return (
    <div className="week-section">
      {isLatest && (
        <>
          {/* ── hero score card ── */}
          <div className="hero-card">
            <div className="hero-top">
              <div className="hero-score-block">
                <p className="hero-eyebrow">Weekly score</p>
                <p className="hero-num">{score}</p>
                <p className={`hero-status ${score >= 60 ? 'good' : 'warn'}`}>
                  {score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Needs attention'}
                </p>
              </div>
              <div className="hero-ring">
                <svg width="62" height="62" viewBox="0 0 62 62">
                  <circle className="hero-ring-track" cx="31" cy="31" r="26" />
                  <circle className="hero-ring-fill" cx="31" cy="31" r="26"
                    strokeDasharray="163.4"
                    strokeDashoffset={163.4 - (163.4 * Math.min(100, score)) / 100} />
                </svg>
              </div>
            </div>
            <div className="vitals-scroll">
              <div className="vital-pill">
                <Ic d={I.weight} size={15} />
                <div className="vital-pill-val">{lastW ? n1(lastW) : '—'}<span className="vital-pill-unit">kg</span></div>
                <div className={`vital-pill-sub ${deltaW != null ? (deltaW <= 0 ? 'ok' : 'warn') : ''}`}>
                  {deltaW != null ? `${deltaW <= 0 ? '▼' : '▲'} ${Math.abs(deltaW).toFixed(1)} kg` : 'Not logged'}
                </div>
              </div>
              <div className="vital-pill">
                <Ic d={I.water} size={15} />
                <div className="vital-pill-val">{totalWater > 0 ? avgWater.toFixed(1) : '—'}<span className="vital-pill-unit">L/day</span></div>
                <div className={`vital-pill-sub ${totalWater > 0 ? (avgWater >= 2.5 ? 'ok' : 'warn') : ''}`}>
                  {totalWater > 0 ? (avgWater >= 2.5 ? 'On target' : 'Low') : 'Not logged'}
                </div>
              </div>
              <div className="vital-pill">
                <Ic d={I.sleep} size={15} />
                <div className="vital-pill-val">{avgSleep != null ? avgSleep.toFixed(1) : '—'}<span className="vital-pill-unit">hrs</span></div>
                <div className={`vital-pill-sub ${avgSleep != null ? (avgSleep >= 7 && avgSleep <= 9 ? 'ok' : 'warn') : ''}`}>
                  {avgSleep != null ? (avgSleep >= 7 && avgSleep <= 9 ? 'Good range' : 'Outside target') : 'Not logged'}
                </div>
              </div>
              <div className="vital-pill">
                <Ic d={I.mood} size={15} />
                <div className="vital-pill-val">{avgMood != null ? Math.round(avgMood) : '—'}<span className="vital-pill-unit">/5</span></div>
                <div className="vital-pill-sub">{avgMood != null ? moodLabel[Math.round(avgMood)] : 'Not logged'}</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── week strip ── */}
      <div className="panel week-panel">
        <div className="week-label">{isLatest ? 'This week' : 'Week'} · {fmtDate(weekData.window.start)} – {fmtDate(weekData.window.end)}</div>
        <div className="week-strip">
          {days.map(day => {
            const isToday = sameDay(day, today)
            const isAppt = sameDay(day, apptDate)
            const hits = dayData(day)
            const hasAny = Object.values(hits).some(Boolean)
            return (
              <div key={day.toISOString()} className={`wday ${isToday ? 'wday-today' : ''} ${isAppt ? 'wday-appt' : ''} ${hasAny && !isToday && !isAppt ? 'wday-has' : ''}`}>
                <div className="wday-name">{DAY_NAMES[day.getDay()]}</div>
                <div className="wday-circle">{day.getDate()}</div>
                <div className="wday-dot-row">
                  {hits.weight && <div className="wd g" />}
                  {hits.inj && <div className="wd r" />}
                  {hits.craving && <div className="wd p" />}
                  {hits.side && <div className="wd a" />}
                  {hits.activity && <div className="wd b" />}
                  {hits.sleep && <div className="wd v" />}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {isLatest && (
        <>
          {/* ── journey banner ── */}
          <div className="journey-banner">
            <div className="jb-top-row">
              <span className="jb-eyebrow">
                Treatment journey{weekNum ? ` · Week ${weekNum}` : ''}{monthNum ? ` · Month ${monthNum}` : ''}
              </span>
              <div className="jb-badges">
                {weekNum && <span className="jb-badge">Week {weekNum}</span>}
                {daysToAppt >= 0 && (
                  <span className={`jb-badge ${daysToAppt <= 2 ? 'jb-badge-appt' : ''}`}>
                    {daysToAppt === 0 ? 'Doctor today' : daysToAppt === 1 ? 'Doctor tomorrow' : `Doctor in ${daysToAppt} days`}
                  </span>
                )}
              </div>
            </div>
            <div className="jb-stats">
              <div className="jbs">
                <div className={`jbs-v ${lostTotal != null && lostTotal > 0 ? 'green' : ''}`}>
                  {lostTotal != null ? `-${lostTotal.toFixed(1)}` : '—'}
                </div>
                <div className="jbs-l">kg lost total</div>
              </div>
              <div className="jbs">
                <div className="jbs-v">{lastW ? n1(lastW) : '—'}</div>
                <div className="jbs-l">current kg</div>
              </div>
              <div className="jbs">
                <div className={`jbs-v ${avgCraving != null ? (avgCraving <= 2 ? 'green' : 'amber') : ''}`}>
                  {avgCraving != null ? avgCraving.toFixed(1) : '—'}
                </div>
                <div className="jbs-l">craving avg</div>
              </div>
              <div className="jbs">
                <div className={`jbs-v ${giClear ? 'green' : 'red'}`}>{sideFx.length}</div>
                <div className="jbs-l">GI events</div>
              </div>
            </div>
            {journeyPct != null && (
              <div className="jb-progress-row">
                <span className="jb-prog-label">Weight goal</span>
                <div className="jb-prog-track">
                  <div className="jb-prog-fill" style={{ width: `${journeyPct}%` }} />
                </div>
                <span className="jb-prog-val">{journeyPct.toFixed(0)}%</span>
              </div>
            )}
            {ladder.length > 0 && (
              <div className="jb-ladder-row">
                <span className="jb-prog-label">Dose ladder</span>
                <div className="jb-ladder">
                  {ladder.map((s, i) => (
                    <div key={s} className="jb-ladder-step">
                      {i > 0 && <div className={`jb-rung ${i <= curRung ? 'done' : ''}`} />}
                      <div className={`jb-dot ${i < curRung ? 'done' : i === curRung ? 'cur' : ''}`} />
                    </div>
                  ))}
                </div>
                <span className="jb-prog-val">{lastDose ? `${lastDose}mg` : '—'}</span>
              </div>
            )}
          </div>

          {/* ── alert bar ── */}
          {daysToAppt >= 0 && daysToAppt <= 4 && (
            <div className="alert-bar">
              <Ic d={I.report} size={15} />
              <span>
                {daysToAppt <= 1 ? 'Doctor visit very soon — ' : `${daysToAppt} days until your appointment — `}
                log weight, craving and any side effects for your report.
              </span>
            </div>
          )}

          {/* ── GI tolerance status banner ── */}
          <div className="panel report-strip" style={{ cursor: 'pointer' }}>
            <div className="rs-icon" style={{ background: giClear ? '#eaf3de' : '#fae8e3', color: giClear ? '#27500a' : '#712b13' }}>
              <Ic d={I.bolt} size={18} />
            </div>
            <div className="rs-text">
              <div className="rs-title">GI tolerance: {giClear ? 'clear' : `${sideFx.length} event${sideFx.length === 1 ? '' : 's'}`}</div>
              <div className="rs-sub">{giClear ? 'Ready to escalate dose' : 'Review before increasing dose'}</div>
            </div>
            <Ic d={I.chevR} size={16} />
          </div>
        </>
      )}

      {/* ── GLP-1 parameters ── */}
      <div className="panel">
        <div className="panel-h"><h2>GLP-1 health parameters</h2></div>
        <div className="params-grid">

          <div className="param-card">
            <div className="pc-head">
              <div className="pc-icon" style={{ background: '#e6f1fb', color: '#0c447c' }}><Ic d={I.protein} size={13} /></div>
              <div><div className="pc-title">Protein</div><div className="pc-sub">Target ≥ 1.2 g/kg/day</div></div>
            </div>
            <div className={`pc-val ${protPerKg != null ? (protPerKg >= 1.2 ? 'green' : 'amber') : ''}`}>
              {protPerKg != null ? protPerKg.toFixed(2) : '—'}<span className="pc-unit">g/kg/day</span>
            </div>
            <StatBar value={protPerKg || 0} max={1.6} color={protPerKg >= 1.2 ? '#1d9e75' : '#ba7517'} />
            <div className="pc-note">{protPerKg != null ? (protPerKg >= 1.2 ? 'On target' : 'Below minimum — lean mass risk') : 'Not logged'}</div>
          </div>

          <div className="param-card">
            <div className="pc-head">
              <div className="pc-icon" style={{ background: '#e6f1fb', color: '#0c447c' }}><Ic d={I.water} size={13} /></div>
              <div><div className="pc-title">Hydration</div><div className="pc-sub">Target ≥ 2.5 L/day</div></div>
            </div>
            <div className={`pc-val ${avgWater >= 2.5 ? 'green' : avgWater >= 1.5 ? 'amber' : 'warn'}`}>
              {totalWater > 0 ? avgWater.toFixed(1) : '—'}<span className="pc-unit">L/day</span>
            </div>
            <StatBar value={avgWater || 0} max={2.5} color={avgWater >= 2.5 ? '#1d9e75' : '#ba7517'} />
            <div className="pc-note">{totalWater > 0 ? (avgWater >= 2.5 ? 'On target' : 'Increase intake') : 'Not logged'}</div>
          </div>

          <div className="param-card">
            <div className="pc-head">
              <div className="pc-icon" style={{ background: '#faeeda', color: '#633806' }}><Ic d={I.activity} size={13} /></div>
              <div><div className="pc-title">Activity</div><div className="pc-sub">Target ≥ 150 min/week</div></div>
            </div>
            <div className={`pc-val ${totalActiveMin >= 150 ? 'green' : totalActiveMin >= 60 ? 'amber' : 'warn'}`}>
              {totalActiveMin || '—'}<span className="pc-unit">min</span>
            </div>
            <StatBar value={totalActiveMin} max={150} color={totalActiveMin >= 150 ? '#1d9e75' : '#ba7517'} />
            <div className="pc-note">{resistanceMin > 0 ? `${resistanceMin}min resistance` : 'No resistance training'}</div>
          </div>

          <div className="param-card">
            <div className="pc-head">
              <div className="pc-icon" style={{ background: '#eeedfe', color: '#3c3489' }}><Ic d={I.sleep} size={13} /></div>
              <div><div className="pc-title">Sleep</div><div className="pc-sub">Target 7–9 hrs</div></div>
            </div>
            <div className={`pc-val ${avgSleep != null ? (avgSleep >= 7 && avgSleep <= 9 ? 'green' : 'amber') : ''}`}>
              {avgSleep != null ? avgSleep.toFixed(1) : '—'}<span className="pc-unit">hrs avg</span>
            </div>
            <StatBar value={avgSleep || 0} max={9} color={avgSleep >= 7 ? '#1d9e75' : '#ba7517'} />
            <div className="pc-note">{avgSleep != null ? (avgSleep >= 7 && avgSleep <= 9 ? 'Good range' : 'Outside target') : 'Not logged'}</div>
          </div>

          <div className="param-card param-card-wide">
            <div className="pc-head">
              <div className="pc-icon" style={{ background: '#fbeaf0', color: '#72243e' }}><Ic d={I.mood} size={13} /></div>
              <div><div className="pc-title">Energy & mood</div><div className="pc-sub">Daily self-report</div></div>
            </div>
            <div className="mood-row">
              {[1,2,3,4,5].map(s => {
                const rounded = avgMood ? Math.round(avgMood) : null
                const active = rounded === s
                return (
                  <div key={s} className={`mood-btn ${active ? 'mood-active' : ''}`}
                    onClick={() => isLatest && setOpenLog('mood')}>
                    <div className="mood-num">{s}</div>
                    <div className="mood-label">{['Low','Okay','Good','Great','Best'][s-1]}</div>
                  </div>
                )
              })}
            </div>
            <div className="pc-note" style={{ marginTop: 6 }}>
              {avgMood != null ? `Average ${avgMood.toFixed(1)}/5 — ${moodLabel[Math.round(avgMood)]}` : 'No mood logged this week'}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── PastWeekRow ───────────────────────────────────────────────────────────────
// Compact, single-line summary for a past week. Tap to expand/collapse.
function PastWeekRow({ weekData, profile, isOpen, onToggle }) {
  const m = computeWeekMetrics(weekData, profile)
  const { score, lastW, deltaW } = m
  return (
    <button className="pw-row" onClick={onToggle}>
      <div className="pw-row-main">
        <span className="pw-row-dates">{fmtDate(weekData.window.start)} – {fmtDate(weekData.window.end)}</span>
        <span className="pw-row-sub">
          {lastW ? `${n1(lastW)} kg` : 'No weight logged'}
          {deltaW != null && ` · ${deltaW <= 0 ? '▼' : '▲'} ${Math.abs(deltaW).toFixed(1)} kg`}
        </span>
      </div>
      <div className="pw-row-right">
        <span className={`pw-score ${score >= 60 ? 'good' : 'warn'}`}>{score}</span>
        <Ic d={I.chevR} size={15} className={`pw-chev ${isOpen ? 'pw-chev-open' : ''}`} />
      </div>
    </button>
  )
}

// ── PastWeekDetail ───────────────────────────────────────────────────────────
// Expanded view for a single past week: day strip + GLP-1 params only
// (treatment-wide banners like journey/GI status live on the current week only).
function PastWeekDetail({ weekData, profile, appointment }) {
  const m = computeWeekMetrics(weekData, profile)
  const { protPerKg, totalWater, avgWater, totalActiveMin, resistanceMin, avgSleep, avgMood, moodLabel, dayData } = m
  const today = new Date()
  const apptDate = new Date(appointment.appointment_date + 'T12:00:00')
  const days = weekDays(weekData.window.end)

  return (
    <div className="pw-detail">
      <div className="week-strip">
        {days.map(day => {
          const isToday = sameDay(day, today)
          const isAppt = sameDay(day, apptDate)
          const hits = dayData(day)
          const hasAny = Object.values(hits).some(Boolean)
          return (
            <div key={day.toISOString()} className={`wday ${isToday ? 'wday-today' : ''} ${isAppt ? 'wday-appt' : ''} ${hasAny && !isToday && !isAppt ? 'wday-has' : ''}`}>
              <div className="wday-name">{DAY_NAMES[day.getDay()]}</div>
              <div className="wday-circle">{day.getDate()}</div>
              <div className="wday-dot-row">
                {hits.weight && <div className="wd g" />}
                {hits.inj && <div className="wd r" />}
                {hits.craving && <div className="wd p" />}
                {hits.side && <div className="wd a" />}
                {hits.activity && <div className="wd b" />}
                {hits.sleep && <div className="wd v" />}
              </div>
            </div>
          )
        })}
      </div>

      <div className="params-grid" style={{ marginTop: 12 }}>
        <div className="param-card">
          <div className="pc-head">
            <div className="pc-icon" style={{ background: '#e6f1fb', color: '#0c447c' }}><Ic d={I.protein} size={13} /></div>
            <div><div className="pc-title">Protein</div></div>
          </div>
          <div className={`pc-val ${protPerKg != null ? (protPerKg >= 1.2 ? 'green' : 'amber') : ''}`}>
            {protPerKg != null ? protPerKg.toFixed(2) : '—'}<span className="pc-unit">g/kg/day</span>
          </div>
        </div>
        <div className="param-card">
          <div className="pc-head">
            <div className="pc-icon" style={{ background: '#e6f1fb', color: '#0c447c' }}><Ic d={I.water} size={13} /></div>
            <div><div className="pc-title">Hydration</div></div>
          </div>
          <div className={`pc-val ${avgWater >= 2.5 ? 'green' : avgWater >= 1.5 ? 'amber' : 'warn'}`}>
            {totalWater > 0 ? avgWater.toFixed(1) : '—'}<span className="pc-unit">L/day</span>
          </div>
        </div>
        <div className="param-card">
          <div className="pc-head">
            <div className="pc-icon" style={{ background: '#faeeda', color: '#633806' }}><Ic d={I.activity} size={13} /></div>
            <div><div className="pc-title">Activity</div></div>
          </div>
          <div className={`pc-val ${totalActiveMin >= 150 ? 'green' : totalActiveMin >= 60 ? 'amber' : 'warn'}`}>
            {totalActiveMin || '—'}<span className="pc-unit">min</span>
          </div>
        </div>
        <div className="param-card">
          <div className="pc-head">
            <div className="pc-icon" style={{ background: '#eeedfe', color: '#3c3489' }}><Ic d={I.sleep} size={13} /></div>
            <div><div className="pc-title">Sleep</div></div>
          </div>
          <div className={`pc-val ${avgSleep != null ? (avgSleep >= 7 && avgSleep <= 9 ? 'green' : 'amber') : ''}`}>
            {avgSleep != null ? avgSleep.toFixed(1) : '—'}<span className="pc-unit">hrs avg</span>
          </div>
        </div>
        <div className="param-card param-card-wide">
          <div className="pc-head">
            <div className="pc-icon" style={{ background: '#fbeaf0', color: '#72243e' }}><Ic d={I.mood} size={13} /></div>
            <div><div className="pc-title">Energy & mood</div></div>
          </div>
          <div className="pc-note">{avgMood != null ? `Average ${avgMood.toFixed(1)}/5 — ${moodLabel[Math.round(avgMood)]}` : 'No mood logged this week'}</div>
        </div>
      </div>
    </div>
  )
}

// ── OverallCard ───────────────────────────────────────────────────────────────
function OverallCard({ overall }) {
  if (!overall) return null
  const { totalLost, lastLoggedW, totalInjections, totalSideEffects, trackingSince } = overall
  return (
    <div className="panel overall-card">
      <div className="panel-h"><h2>Overall progress</h2>
        {trackingSince && <div className="sub">Tracking since {fmtDate(trackingSince)}</div>}
      </div>
      <div className="overall-grid">
        <div className="overall-stat">
          <div className={`overall-v ${totalLost != null && totalLost > 0 ? 'green' : ''}`}>
            {totalLost != null ? `-${totalLost.toFixed(1)}` : '—'}
          </div>
          <div className="overall-l">kg lost all-time</div>
        </div>
        <div className="overall-stat">
          <div className="overall-v">{lastLoggedW != null ? n1(lastLoggedW) : '—'}</div>
          <div className="overall-l">current kg</div>
        </div>
        <div className="overall-stat">
          <div className="overall-v">{totalInjections}</div>
          <div className="overall-l">total doses</div>
        </div>
        <div className="overall-stat">
          <div className={`overall-v ${totalSideEffects === 0 ? 'green' : ''}`}>{totalSideEffects}</div>
          <div className="overall-l">side effects logged</div>
        </div>
      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────
const WEEKS_PAGE = 8

export default function Dashboard({ session }) {
  const userId = session.user.id
  const [profile, setProfile] = useState(null)
  const [appointment, setAppointment] = useState(null)
  const [data, setData] = useState(null)
  const [weeksToShow, setWeeksToShow] = useState(WEEKS_PAGE)
  const [expandedWeek, setExpandedWeek] = useState(null)
  const [overall, setOverall] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openLog, setOpenLog] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [toast, setToast] = useState(null)

  const win = useMemo(
    () => appointment ? reportWindow(new Date(appointment.appointment_date + 'T12:00:00')) : null,
    [appointment]
  )

  // Anchor the appointment date to exactly 7 days after the very first
  // injection ever logged. Re-runs (cheaply) after every save; only writes
  // when the computed date actually differs from what's stored.
  const syncAppointmentToFirstInjection = useCallback(async (currentAppt) => {
    const { data: firstInj } = await supabase.from('injections').select('injected_at')
      .order('injected_at', { ascending: true }).limit(1).maybeSingle()
    if (!firstInj) return currentAppt
    const anchored = new Date(firstInj.injected_at)
    anchored.setDate(anchored.getDate() + 7)
    const anchoredISO = toISODate(anchored)
    if (currentAppt && currentAppt.appointment_date === anchoredISO) return currentAppt
    if (currentAppt) {
      const { data: updated } = await supabase.from('appointments')
        .update({ appointment_date: anchoredISO })
        .eq('id', currentAppt.id).select().single()
      return updated || currentAppt
    }
    const { data: created } = await supabase.from('appointments')
      .insert({ user_id: userId, appointment_date: anchoredISO }).select().single()
    return created || currentAppt
  }, [userId])

  useEffect(() => {
    let active = true
    ;(async () => {
      let { data: p } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      if (!p) {
        await supabase.from('profiles').insert({ id: userId, full_name: session.user.email })
        p = { id: userId, full_name: session.user.email }
      }
      let { data: appts } = await supabase.from('appointments').select('*')
        .order('appointment_date', { ascending: false }).limit(1)
      let appt = appts?.[0] || null
      if (!appt) {
        const { data: created } = await supabase.from('appointments')
          .insert({ user_id: userId, appointment_date: toISODate(nextTuesday()) }).select().single()
        appt = created
      }
      appt = await syncAppointmentToFirstInjection(appt)
      if (!active) return
      setProfile(p); setAppointment(appt)
    })()
    return () => { active = false }
  }, [userId, session.user.email, syncAppointmentToFirstInjection])

  const loadOverall = useCallback(async () => {
    const q = (table, tf, cols = '*') => supabase.from(table).select(cols).order(tf, { ascending: true })
    const [weights, injections, symptoms, firstW] = await Promise.all([
      q('weight_logs', 'logged_at', 'weight_kg,logged_at'),
      q('injections', 'injected_at', 'injected_at,dose_mg,drug'),
      q('symptoms', 'occurred_at', 'type,severity,occurred_at'),
      supabase.from('weight_logs').select('weight_kg,logged_at').order('logged_at', { ascending: true }).limit(1),
    ])
    const ws = weights.data || []
    const firstLoggedW = firstW.data?.[0]?.weight_kg ? Number(firstW.data[0].weight_kg) : null
    const lastLoggedW = ws.length ? Number(ws[ws.length - 1].weight_kg) : null
    const totalLost = firstLoggedW != null && lastLoggedW != null ? firstLoggedW - lastLoggedW : null
    const inj = injections.data || []
    const sideFx = (symptoms.data || []).filter(s => s.type?.toLowerCase() !== 'craving')
    const firstDate = ws[0]?.logged_at || inj[0]?.injected_at || null
    setOverall({
      totalLost, firstLoggedW, lastLoggedW,
      totalInjections: inj.length,
      totalSideEffects: sideFx.length,
      trackingSince: firstDate,
    })
  }, [])

  useEffect(() => { loadOverall() }, [loadOverall])

  const weekWindows = useMemo(
    () => win ? weekWindowsBack(win.end, weeksToShow) : [],
    [win, weeksToShow]
  )

  const loadData = useCallback(async () => {
    if (!weekWindows.length) return
    setLoading(true)
    const fetchWindow = async (w) => {
      const s = w.start.toISOString(), e = w.end.toISOString()
      const q = (table, tf) => supabase.from(table).select('*').gte(tf, s).lte(tf, e).order(tf, { ascending: true })
      const [weights, injections, meals, water, activities, medLogs, symptoms, sleep, mood, prev] =
        await Promise.all([
          q('weight_logs', 'logged_at'), q('injections', 'injected_at'), q('meals', 'eaten_at'),
          q('water_logs', 'logged_at'), q('activities', 'started_at'), q('medication_logs', 'taken_at'),
          q('symptoms', 'occurred_at'),
          q('sleep_logs', 'logged_at'), q('mood_logs', 'logged_at'),
          supabase.from('weight_logs').select('weight_kg').lt('logged_at', s)
            .order('logged_at', { ascending: false }).limit(1),
        ])
      return {
        window: w,
        weights: weights.data || [], injections: injections.data || [], meals: meals.data || [],
        water: water.data || [], activities: activities.data || [], medicationLogs: medLogs.data || [],
        symptoms: symptoms.data || [],
        sleep: sleep.data || [], mood: mood.data || [],
        prevWeight: prev.data?.[0]?.weight_kg ?? null,
      }
    }
    const [meds, ...weeks] = await Promise.all([
      supabase.from('medications').select('*').eq('active', true),
      ...weekWindows.map(fetchWindow),
    ])
    setData({ medications: meds.data || [], weeks })
    setLoading(false)
  }, [weekWindows])

  useEffect(() => { loadData() }, [loadData])

  function flash(text, type = 'ok') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function onSaved(savedType) {
    setOpenLog(null)
    if (savedType === 'injection') {
      const updated = await syncAppointmentToFirstInjection(appointment)
      setAppointment(updated)
    }
    loadData(); loadOverall(); flash('Saved.')
  }

  if (loading || !data || !appointment) {
    return (
      <div className="loading">
        <div className="stack"><div className="spin" /><span>Loading…</span></div>
      </div>
    )
  }

  const today = new Date()
  const apptDate = new Date(appointment.appointment_date + 'T12:00:00')
  const daysToAppt = Math.ceil((apptDate - today) / (24 * 60 * 60 * 1000))
  const latestWeek = data.weeks[0]
  const latestMetrics = computeWeekMetrics(latestWeek, profile)
  const { weekNum, monthNum } = latestMetrics

  function downloadPDF() {
    try {
      const doc = buildReportDoc({ profile, appointment, window: latestWeek.window, data: latestWeek })
      doc.save(`glp1-report-week${weekNum || ''}.pdf`)
      flash('Report downloaded.')
    } catch (err) {
      flash('Could not build report: ' + err.message, 'err')
    }
  }

  return (
    <div className="app">
      {/* ── topbar ── */}
      <header className="appbar">
        <div className="brand">
          <div className="brand-mark">✚</div>
          <div>
            <h1>GLP-1 Tracker</h1>
            <small>{profile?.full_name || session.user.email}</small>
          </div>
        </div>
        <div className="appbar-actions">
          <button className="icon-btn" onClick={downloadPDF} aria-label="Download report">
            <Ic d={I.report} size={20} />
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Ic d={I.gear} size={20} />
          </button>
          <button className="icon-btn" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
            <Ic d={I.out} size={20} />
          </button>
        </div>
      </header>

      <div className="week-feed">
        <OverallCard overall={overall} />

        <WeekSection
          weekData={data.weeks[0]}
          profile={profile}
          appointment={appointment}
          isLatest={true}
          setOpenLog={setOpenLog}
        />

        {data.weeks.length > 1 && (
          <div className="panel pw-panel">
            <div className="panel-h"><h2>Past weeks</h2></div>
            <div className="pw-list">
              {data.weeks.slice(1).map(wk => {
                const key = wk.window.start.toISOString()
                const isOpen = expandedWeek === key
                return (
                  <div key={key} className="pw-item">
                    <PastWeekRow
                      weekData={wk}
                      profile={profile}
                      isOpen={isOpen}
                      onToggle={() => setExpandedWeek(isOpen ? null : key)}
                    />
                    {isOpen && (
                      <PastWeekDetail weekData={wk} profile={profile} appointment={appointment} />
                    )}
                  </div>
                )
              })}
            </div>
            <button className="btn pw-more-btn" onClick={() => setWeeksToShow(n => n + WEEKS_PAGE)}>
              Load earlier weeks
            </button>
          </div>
        )}


      {/* ── log buttons ── */}
      <div className="panel">
        <div className="panel-h"><h2>Log something</h2><div className="sub">One tap — adjust time on next screen.</div></div>
        <div className="log-grid">
          {QUICK.map(q => (
            <button key={q.type} className={`log-tile ${q.isNew ? 'tile-new' : ''}`}
              onClick={() => setOpenLog(q.type)}>
              <span className="log-tile-box" style={{ background: q.bg, color: q.fg }}>
                <Ic d={q.d} size={22} />
              </span>
              <span className="log-tile-label">{q.label}</span>
            </button>
          ))}
        </div>
      </div>

      <MedsCard userId={userId} meds={data.medications} onLogged={loadData} flash={flash} />

      <AppleHealthCard userId={userId} window={latestWeek.window} onImported={loadData} flash={flash} />

      {/* ── report strip ── */}
      <div className="panel report-strip">
        <div className="rs-icon"><Ic d={I.report} size={20} /></div>
        <div className="rs-text">
          <div className="rs-title">Doctor report</div>
          <div className="rs-sub">Week {weekNum || '—'} · Full scorecard for {appointment.clinician || 'your doctor'}</div>
        </div>
        <button className="btn btn-primary rs-btn" onClick={downloadPDF}>Download PDF</button>
      </div>

      </div>

      {/* ── bottom tab bar (mobile only — hidden ≥760px via CSS) ── */}
      <nav className="tabbar">
        <button className="tab-item active"><Ic d={I.home} size={20} /><span>Home</span></button>
        <button className="tab-item"><Ic d={I.trend} size={20} /><span>Trends</span></button>
        <div className="tab-fab">
          <button className="tab-fab-circle" onClick={() => setOpenLog('weight')} aria-label="Log something">
            <Ic d={I.plus} size={22} />
          </button>
        </div>
        <button className="tab-item" onClick={downloadPDF}><Ic d={I.report} size={20} /><span>Reports</span></button>
        <button className="tab-item" onClick={() => setShowSettings(true)}><Ic d={I.user} size={20} /><span>Profile</span></button>
      </nav>

      {/* ── toast ── */}
      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}

      {/* ── modals ── */}
      {openLog && (
        <LogModal type={openLog} userId={userId} onClose={() => setOpenLog(null)} onSaved={onSaved} />
      )}
      {showSettings && (
        <Settings userId={userId} profile={profile} appointment={appointment}
          onClose={() => setShowSettings(false)}
          onChange={(p, a) => { setProfile(p); setAppointment(a) }} />
      )}
    </div>
  )
}

// ── MedsCard ──────────────────────────────────────────────────────────────────
function MedsCard({ userId, meds, onLogged, flash }) {
  async function log(medId) {
    await supabase.from('medication_logs').insert({ user_id: userId, medication_id: medId, taken_at: new Date().toISOString() })
    flash('Medication logged.')
    onLogged()
  }
  if (!meds?.length) return null
  return (
    <div className="panel">
      <div className="panel-h"><h2>Medications</h2></div>
      <div className="med-list">
        {meds.map(m => (
          <div key={m.id} className="med-row">
            <div className="med-info">
              <span className="med-name">{m.name}</span>
              {m.dose && <span className="med-dose">{m.dose}</span>}
            </div>
            <button className="btn" onClick={() => log(m.id)}>Taken</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── AppleHealthCard ───────────────────────────────────────────────────────────
function AppleHealthCard({ userId, window, onImported, flash }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  async function handleFile(ev) {
    const file = ev.target.files?.[0]; if (!file) return
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = parseAppleHealthExport(text, window.start, window.end)
      await supabase.from('activities').delete().eq('user_id', userId).eq('source', 'healthkit')
        .gte('started_at', window.start.toISOString()).lte('started_at', window.end.toISOString())
      await supabase.from('weight_logs').delete().eq('user_id', userId).eq('source', 'healthkit')
        .gte('logged_at', window.start.toISOString()).lte('logged_at', window.end.toISOString())
      if (parsed.activities.length) await supabase.from('activities').insert(parsed.activities.map(a => ({ ...a, user_id: userId })))
      if (parsed.weights.length) await supabase.from('weight_logs').insert(parsed.weights.map(w => ({ ...w, user_id: userId, source: 'healthkit' })))
      flash(`Imported ${parsed.activities.length} activities and ${parsed.weights.length} weight readings.`)
      onImported()
    } catch (err) { flash('Could not read file. ' + err.message, 'err') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Apple Watch &amp; Health</h2>
        <div className="sub">Health app → Export All Health Data → upload export.xml</div>
      </div>
      <input ref={fileRef} type="file" accept=".xml" onChange={handleFile} style={{ display: 'none' }} />
      <button className="btn btn-block" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Reading…' : 'Sync from Apple Health'}
      </button>
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────────────
function Settings({ userId, profile, appointment, onClose, onChange }) {
  const [name, setName] = useState(profile?.full_name || '')
  const [height, setHeight] = useState(profile?.height_cm || '')
  const [drug, setDrug] = useState(profile?.glp1_drug || '')
  const [baseline, setBaseline] = useState(profile?.baseline_weight_kg || '')
  const [treatStart, setTreatStart] = useState(profile?.treatment_start_date || '')
  const [apptDate, setApptDate] = useState(appointment?.appointment_date || '')
  const [clinician, setClinician] = useState(appointment?.clinician || '')
  const [meds, setMeds] = useState([])
  const [newMed, setNewMed] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('medications').select('*').eq('active', true).then(({ data }) => setMeds(data || []))
  }, [])

  async function save() {
    setBusy(true)
    const { data: p } = await supabase.from('profiles')
      .update({ full_name: name, height_cm: height || null, glp1_drug: drug || null,
        baseline_weight_kg: baseline || null, treatment_start_date: treatStart || null })
      .eq('id', userId).select().single()
    let a = appointment
    if (apptDate) {
      const { data: au } = await supabase.from('appointments')
        .update({ appointment_date: apptDate, clinician: clinician || null })
        .eq('id', appointment.id).select().single()
      a = au || appointment
    }
    setBusy(false); onChange(p, a); onClose()
  }

  async function addMed() {
    if (!newMed.trim()) return
    const { data } = await supabase.from('medications').insert({ user_id: userId, name: newMed.trim() }).select().single()
    if (data) setMeds(m => [...m, data]); setNewMed('')
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-h"><h3>Settings</h3><div className="sub">Treatment details for your report.</div></div>
        <div className="sheet-body">
          <div className="field"><label>Your name</label><input value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="field"><label>Height (cm)</label><input type="number" value={height} onChange={e => setHeight(e.target.value)} /></div>
          <div className="field"><label>GLP-1 medication</label><input value={drug} onChange={e => setDrug(e.target.value)} placeholder="e.g. Semaglutide" /></div>
          <div className="field"><label>Baseline weight (kg)</label><input type="number" value={baseline} onChange={e => setBaseline(e.target.value)} placeholder="Weight when you started" /></div>
          <div className="field"><label>Treatment start date</label><input type="date" value={treatStart} onChange={e => setTreatStart(e.target.value)} /></div>
          <div className="field"><label>Next appointment</label><input type="date" value={apptDate} onChange={e => setApptDate(e.target.value)} /></div>
          <div className="field"><label>Doctor's name</label><input value={clinician} onChange={e => setClinician(e.target.value)} /></div>
          <div className="field">
            <label>Other medications</label>
            {meds.length > 0 && <ul className="feed" style={{ marginBottom: 10 }}>{meds.map(m => <li key={m.id}><span className="feed-main">{m.name}</span></li>)}</ul>}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newMed} onChange={e => setNewMed(e.target.value)} placeholder="Add medication"
                onKeyDown={e => e.key === 'Enter' && addMed()} />
              <button className="btn" style={{ flex: '0 0 auto' }} onClick={addMed}>Add</button>
            </div>
          </div>
        </div>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
