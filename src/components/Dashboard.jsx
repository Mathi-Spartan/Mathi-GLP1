import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { LogModal } from './LogForms.jsx'
import { generateWeeklyPDF } from '../lib/pdf.js'
import { parseAppleHealthExport } from '../lib/appleHealth.js'
import {
  nextTuesday,
  reportWindow,
  weekDays,
  sameDay,
  fmtDate,
  toISODate,
} from '../lib/week.js'

/* ---------- inline icons (stroke, currentColor) ---------- */
const P = {
  weight: 'M12 3a2 2 0 0 1 1.9 1.4H19a2 2 0 0 1 2 2v.2L18.5 17a3 3 0 0 1-5.9 0L10 6.6V6.4A2 2 0 0 1 5 6.4H10.1A2 2 0 0 1 12 3ZM5 6.4 2.5 17a3 3 0 0 0 5.9 0L6 6.4',
  injection: 'm18 2 4 4M17 3l4 4-9.5 9.5-4.5 1 1-4.5L17 3ZM10.5 9.5l4 4M3 21l4-4',
  meal: 'M5 2v8m3-8v8M6.5 2v8M6.5 14v8M18 2c-1.5 1-2 3-2 6s.5 4 2 5v9',
  water: 'M12 3s6 6.4 6 10.5A6 6 0 0 1 6 13.5C6 9.4 12 3 12 3Z',
  activity: 'M4 13h3l2.5-7 4 14 2.5-7H20',
  symptom: 'M3 12h4l2-5 3 9 2-4h7',
  craving: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5Z',
  pill: 'M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7l-6 6ZM8 8l8 8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.2-1.3L15.3 2h-4l-.5 2.5a8 8 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.2 1.3l.5 2.5h4l.5-2.5a8 8 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h6',
}
function Ic({ name, size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  )
}

const QUICK = [
  { type: 'weight', icon: 'weight', label: 'Weight' },
  { type: 'injection', icon: 'injection', label: 'Injection' },
  { type: 'meal', icon: 'meal', label: 'Food' },
  { type: 'craving', icon: 'craving', label: 'Craving' },
  { type: 'water', icon: 'water', label: 'Water' },
  { type: 'activity', icon: 'activity', label: 'Activity' },
  { type: 'symptom', icon: 'symptom', label: 'Side effect' },
]

export default function Dashboard({ session }) {
  const userId = session.user.id
  const [profile, setProfile] = useState(null)
  const [appointment, setAppointment] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openLog, setOpenLog] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [toast, setToast] = useState(null)

  const window = useMemo(
    () => (appointment ? reportWindow(new Date(appointment.appointment_date + 'T12:00:00')) : null),
    [appointment]
  )

  // ---- initial: profile + appointment ----
  useEffect(() => {
    let active = true
    ;(async () => {
      // profile
      let { data: p } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
      if (!p) {
        await supabase.from('profiles').insert({ id: userId, full_name: session.user.email })
        p = { id: userId, full_name: session.user.email }
      }
      // appointment: nearest upcoming, else create next Tuesday
      const todayISO = toISODate(new Date())
      let { data: appts } = await supabase
        .from('appointments')
        .select('*')
        .gte('appointment_date', todayISO)
        .order('appointment_date', { ascending: true })
        .limit(1)
      let appt = appts && appts[0]
      if (!appt) {
        const tue = toISODate(nextTuesday())
        const { data: created } = await supabase
          .from('appointments')
          .insert({ user_id: userId, appointment_date: tue })
          .select()
          .single()
        appt = created
      }
      if (!active) return
      setProfile(p)
      setAppointment(appt)
    })()
    return () => {
      active = false
    }
  }, [userId, session.user.email])

  // ---- load window data whenever the appointment changes ----
  const loadData = useCallback(async () => {
    if (!window) return
    setLoading(true)
    const s = window.start.toISOString()
    const e = window.end.toISOString()
    const q = (table, tf) =>
      supabase.from(table).select('*').gte(tf, s).lte(tf, e).order(tf, { ascending: true })

    const [weights, injections, meals, water, activities, medLogs, symptoms, meds, prev] =
      await Promise.all([
        q('weight_logs', 'logged_at'),
        q('injections', 'injected_at'),
        q('meals', 'eaten_at'),
        q('water_logs', 'logged_at'),
        q('activities', 'started_at'),
        q('medication_logs', 'taken_at'),
        q('symptoms', 'occurred_at'),
        supabase.from('medications').select('*').eq('active', true),
        supabase
          .from('weight_logs')
          .select('weight_kg, logged_at')
          .lt('logged_at', s)
          .order('logged_at', { ascending: false })
          .limit(1),
      ])

    setData({
      weights: weights.data || [],
      injections: injections.data || [],
      meals: meals.data || [],
      water: water.data || [],
      activities: activities.data || [],
      medicationLogs: medLogs.data || [],
      symptoms: symptoms.data || [],
      medications: meds.data || [],
      prevWeight: prev.data && prev.data[0] ? prev.data[0].weight_kg : null,
    })
    setLoading(false)
  }, [window])

  useEffect(() => {
    loadData()
  }, [loadData])

  function flash(text, type = 'ok') {
    setToast({ text, type })
    setTimeout(() => setToast(null), 3500)
  }

  function onSaved() {
    setOpenLog(null)
    loadData()
    flash('Saved.')
  }

  if (loading || !data || !appointment) {
    return (
      <div className="loading">
        <div className="stack">
          <div className="spin" />
          <span>Loading your week…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <div className="brand-mark">✚</div>
          <div>
            <h1>Health Tracker</h1>
            <small>{profile?.full_name || session.user.email}</small>
          </div>
        </div>
        <div className="appbar-actions">
          <button className="icon-btn" aria-label="Settings" onClick={() => setShowSettings(true)}>
            <Ic name="gear" size={20} />
          </button>
          <button className="icon-btn" aria-label="Sign out" onClick={() => supabase.auth.signOut()}>
            <Ic name="out" size={20} />
          </button>
        </div>
      </header>

      <CycleStrip data={data} appointment={appointment} />

      <StatTiles data={data} />

      <div className="panel">
        <div className="panel-h">
          <h2>Log something</h2>
          <div className="sub">One tap. You can adjust the time on the next screen.</div>
        </div>
        <div className="actions actions-log">
          {QUICK.map((q) => (
            <button key={q.type} className="action" onClick={() => setOpenLog(q.type)}>
              <span className="action-ic"><Ic name={q.icon} /></span>
              <span className="action-tx">{q.label}</span>
            </button>
          ))}
        </div>
      </div>

      <MedsCard userId={userId} meds={data.medications} onLogged={loadData} flash={flash} />

      <div className="grid-2">
        <div className="panel">
          <div className="panel-h">
            <h2>Weight this cycle</h2>
            <div className="sub">Tuesday to Tuesday</div>
          </div>
          <WeightSpark weights={data.weights} prevWeight={data.prevWeight} />
        </div>
        <AppleHealthCard userId={userId} window={window} onImported={loadData} flash={flash} />
      </div>

      <RecentLogs data={data} />

      <div className="report">
        <div className="report-row">
          <div className="report-ic"><Ic name="report" /></div>
          <div>
            <h2>Doctor's report</h2>
            <div className="sub">
              Everything from {fmtDate(window.start)} to {fmtDate(window.end)} — weight trend,
              injections, side effects and more, as one clean PDF.
            </div>
          </div>
        </div>
        <button
          className="btn btn-primary btn-block"
          onClick={() => {
            try {
              generateWeeklyPDF({ profile, appointment, window, data })
              flash('Report downloaded. Check your downloads folder.')
            } catch (err) {
              flash('Could not build the report: ' + err.message, 'err')
            }
          }}
        >
          Download weekly PDF
        </button>
      </div>

      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}

      {openLog && (
        <LogModal type={openLog} userId={userId} onClose={() => setOpenLog(null)} onSaved={onSaved} />
      )}
      {showSettings && (
        <Settings
          userId={userId}
          profile={profile}
          appointment={appointment}
          onClose={() => setShowSettings(false)}
          onChange={(p, a) => {
            if (p) setProfile(p)
            if (a) setAppointment(a)
            flash('Settings updated.')
          }}
        />
      )}
    </div>
  )
}

/* ---------------- medications ---------------- */
function MedsCard({ userId, meds, onLogged, flash }) {
  if (!meds || meds.length === 0) return null
  async function take(m) {
    const { error } = await supabase
      .from('medication_logs')
      .insert({ user_id: userId, medication_id: m.id })
    if (error) {
      flash('Could not log: ' + error.message, 'err')
      return
    }
    flash(`Logged ${m.name}.`)
    onLogged()
  }
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Medications</h2>
        <div className="sub">Tap when you take one. Add yours in Settings.</div>
      </div>
      <div className="actions">
        {meds.map((m) => (
          <button key={m.id} className="action is-med" onClick={() => take(m)}>
            <span className="action-ic"><Ic name="pill" /></span>
            <span className="action-tx">{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------- cycle strip (signature element) ---------------- */
function CycleStrip({ data, appointment }) {
  const appt = new Date(appointment.appointment_date + 'T12:00:00')
  const days = weekDays(appt)
  const today = new Date()

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfAppt = new Date(appt.getFullYear(), appt.getMonth(), appt.getDate())
  const daysToAppt = Math.round((startOfAppt - startOfToday) / 86400000)
  const countLabel =
    daysToAppt < 0 ? 'Past due' : daysToAppt === 0 ? 'Today' : daysToAppt === 1 ? 'Tomorrow' : `${daysToAppt} days`

  function dotsFor(day) {
    const has = (arr, tf) => arr.some((r) => sameDay(new Date(r[tf]), day))
    const out = []
    if (has(data.weights, 'logged_at')) out.push('w')
    if (has(data.meals, 'eaten_at')) out.push('m')
    if (has(data.activities, 'started_at')) out.push('a')
    if (has(data.symptoms, 'occurred_at')) out.push('s')
    if (has(data.injections, 'injected_at')) out.push('i')
    return out
  }

  return (
    <div className="cycle">
      <div className="cycle-top">
        <span className="cycle-title">This cycle</span>
        <span className="cycle-count">
          {daysToAppt <= 0 ? 'Appointment' : 'Appointment in'} <b>{countLabel}</b>
        </span>
      </div>
      <div className="cycle-grid">
        {days.map((day) => {
          const isToday = sameDay(day, today)
          const isAppt = sameDay(day, appt)
          return (
            <div key={day.toISOString()} className={`cday${isToday ? ' is-today' : ''}${isAppt ? ' is-appt' : ''}`}>
              {isAppt && <span className="cday-flag">Doctor</span>}
              <div className="cday-wd">{day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</div>
              <div className="cday-dd">{day.getDate()}</div>
              <div className="cday-dots">
                {dotsFor(day).map((d, i) => (
                  <span key={i} className={`cdot ${d}`} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- stat tiles ---------------- */
function StatTiles({ data }) {
  const sorted = [...data.weights].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const last = sorted[sorted.length - 1]?.weight_kg
  const base = data.prevWeight ?? sorted[0]?.weight_kg
  let delta = null
  if (last != null && base != null) delta = last - base

  const stepDays = data.activities.filter((a) => a.steps != null)
  const avgSteps = stepDays.length
    ? Math.round(stepDays.reduce((s, a) => s + a.steps, 0) / stepDays.length)
    : null

  const tiles = [
    { label: 'Weight', value: last != null ? last.toFixed(1) : '—', unit: last != null ? 'kg' : '' },
    {
      label: 'Change',
      value: delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—',
      unit: delta != null ? 'kg' : '',
      delta: delta == null ? null : delta <= 0 ? 'down' : 'up',
    },
    { label: 'Avg steps', value: avgSteps != null ? avgSteps.toLocaleString() : '—', unit: avgSteps != null ? '/day' : '' },
    { label: 'Side effects', value: String(data.symptoms.length), unit: '' },
  ]
  return (
    <div className="stats">
      {tiles.map((t) => (
        <div key={t.label} className="stat">
          <div className="stat-l">{t.label}</div>
          <div className="stat-v">
            {t.value}
            {t.unit && <span className="stat-u">{t.unit}</span>}
          </div>
          {t.delta && (
            <div className={`stat-d ${t.delta}`}>{t.delta === 'down' ? '▼ down' : '▲ up'}</div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------------- weight sparkline (dependency-free SVG) ---------------- */
function WeightSpark({ weights, prevWeight }) {
  const points = [...weights].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  if (prevWeight != null) {
    points.unshift({ weight_kg: prevWeight, logged_at: null, baseline: true })
  }
  if (points.length < 2) {
    return <div className="empty">Log your weight a couple of times to see the trend.</div>
  }
  const W = 520
  const H = 170
  const pad = { l: 40, r: 14, t: 16, b: 22 }
  const vals = points.map((p) => p.weight_kg)
  const min = Math.min(...vals) - 0.4
  const max = Math.max(...vals) + 0.4
  const x = (i) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r)
  const y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b)
  const line = points.map((p, i) => `${x(i)},${y(p.weight_kg)}`).join(' ')
  const area = `${pad.l},${H - pad.b} ${line} ${x(points.length - 1)},${H - pad.b}`
  const mid = (min + max) / 2

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0e7a5c" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0e7a5c" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="grid" x1={pad.l} y1={y(max)} x2={W - pad.r} y2={y(max)} />
      <line className="grid" x1={pad.l} y1={y(mid)} x2={W - pad.r} y2={y(mid)} />
      <line className="axis" x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} />
      <text className="lbl" x={4} y={y(max) + 3}>{max.toFixed(1)}</text>
      <text className="lbl" x={4} y={y(min) + 3}>{min.toFixed(1)}</text>
      <polygon className="area" points={area} />
      <polyline className="ln" points={line} />
      {points.map((p, i) => (
        <circle key={i} className={i === points.length - 1 ? 'pt-last' : 'pt'} cx={x(i)} cy={y(p.weight_kg)} r={i === points.length - 1 ? 4.5 : 3} />
      ))}
    </svg>
  )
}

/* ---------------- Apple Health import ---------------- */
function AppleHealthCard({ userId, window, onImported, flash }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(ev) {
    const file = ev.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const text = await file.text()
      const parsed = parseAppleHealthExport(text, window.start, window.end)
      // make re-import idempotent: clear this window's HealthKit rows first
      await supabase
        .from('activities')
        .delete()
        .eq('user_id', userId)
        .eq('source', 'healthkit')
        .gte('started_at', window.start.toISOString())
        .lte('started_at', window.end.toISOString())
      await supabase
        .from('weight_logs')
        .delete()
        .eq('user_id', userId)
        .eq('source', 'healthkit')
        .gte('logged_at', window.start.toISOString())
        .lte('logged_at', window.end.toISOString())

      const acts = parsed.activities.map((a) => ({ ...a, user_id: userId }))
      const wts = parsed.weights.map((w) => ({ ...w, user_id: userId, source: 'healthkit' }))
      if (acts.length) await supabase.from('activities').insert(acts)
      if (wts.length) await supabase.from('weight_logs').insert(wts)

      flash(`Imported ${acts.length} activity days and ${wts.length} weight readings from Apple Health.`)
      onImported()
    } catch (err) {
      flash('Could not read that file. Make sure it is the export.xml from Apple Health. ' + err.message, 'err')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Apple Watch &amp; Health</h2>
        <div className="sub">
          Your Apple Watch already syncs steps, workouts, energy and weight into the iPhone
          Health app. To pull them in: Health app → your photo → <strong>Export All Health Data</strong>,
          unzip, and upload the <strong>export.xml</strong>. Only this cycle's data is imported.
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".xml" onChange={handleFile} style={{ display: 'none' }} />
      <button className="btn btn-block" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Reading file…' : 'Sync from Apple Health'}
      </button>
    </div>
  )
}

/* ---------------- recent logs ---------------- */
function RecentLogs({ data }) {
  const items = []
  const push = (arr, tf, render, tag, cls) =>
    arr.forEach((r) => items.push({ t: new Date(r[tf]), text: render(r), tag, cls }))

  push(data.injections, 'injected_at', (r) => `${r.drug || 'Injection'} ${r.dose_mg ? r.dose_mg + ' mg' : ''}`, 'Inject', 'bloom')
  push(data.weights.filter((w) => w.source !== 'healthkit'), 'logged_at', (r) => `${r.weight_kg} kg`, 'Weight')
  push(data.meals, 'eaten_at', (r) => `${r.meal_type}: ${r.description || ''}`, 'Food')
  push(data.symptoms, 'occurred_at', (r) => `${r.type}${r.severity ? ` (severity ${r.severity})` : ''}`, 'Effect', 'bloom')
  push(data.activities.filter((a) => a.source !== 'healthkit'), 'started_at', (r) => `${r.type}${r.duration_min ? ` · ${r.duration_min} min` : ''}`, 'Move')
  push(data.water, 'logged_at', (r) => `${r.amount_ml} ml water`, 'Water')

  items.sort((a, b) => b.t - a.t)
  const top = items.slice(0, 12)

  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Recent entries</h2>
        <div className="sub">Your manual logs this cycle. Apple Health data is summarised above and in the PDF.</div>
      </div>
      {top.length === 0 ? (
        <div className="empty">Nothing logged yet this cycle. Use the buttons above to start.</div>
      ) : (
        <ul className="feed">
          {top.map((it, i) => (
            <li key={i}>
              <span className={`feed-tag ${it.cls || ''}`}>{it.tag}</span>
              <span className="feed-main">{it.text}</span>
              <span className="feed-time">{it.t.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ---------------- settings ---------------- */
function Settings({ userId, profile, appointment, onClose, onChange }) {
  const [name, setName] = useState(profile?.full_name || '')
  const [height, setHeight] = useState(profile?.height_cm || '')
  const [drug, setDrug] = useState(profile?.glp1_drug || '')
  const [apptDate, setApptDate] = useState(appointment?.appointment_date || '')
  const [clinician, setClinician] = useState(appointment?.clinician || '')
  const [meds, setMeds] = useState([])
  const [newMed, setNewMed] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('medications')
      .select('*')
      .eq('active', true)
      .then(({ data }) => setMeds(data || []))
  }, [])

  async function save() {
    setBusy(true)
    const { data: p } = await supabase
      .from('profiles')
      .update({ full_name: name, height_cm: height || null, glp1_drug: drug || null })
      .eq('id', userId)
      .select()
      .single()
    let a = appointment
    if (apptDate) {
      const { data: au } = await supabase
        .from('appointments')
        .update({ appointment_date: apptDate, clinician: clinician || null })
        .eq('id', appointment.id)
        .select()
        .single()
      a = au || appointment
    }
    setBusy(false)
    onChange(p, a)
    onClose()
  }

  async function addMed() {
    if (!newMed.trim()) return
    const { data } = await supabase
      .from('medications')
      .insert({ user_id: userId, name: newMed.trim() })
      .select()
      .single()
    if (data) setMeds((m) => [...m, data])
    setNewMed('')
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-h">
          <h3>Settings</h3>
          <div className="sub">Used on your doctor's report.</div>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label>Your name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Height (cm)</label>
            <input type="number" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <div className="field">
            <label>GLP-1 medication</label>
            <input value={drug} onChange={(e) => setDrug(e.target.value)} placeholder="e.g. Semaglutide" />
          </div>
          <div className="field">
            <label>Next appointment</label>
            <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Doctor's name (optional)</label>
            <input value={clinician} onChange={(e) => setClinician(e.target.value)} />
          </div>

          <div className="field">
            <label>Your other medications</label>
            {meds.length > 0 && (
              <ul className="feed" style={{ marginBottom: 10 }}>
                {meds.map((m) => (
                  <li key={m.id}><span className="feed-main">{m.name}</span></li>
                ))}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newMed} onChange={(e) => setNewMed(e.target.value)} placeholder="Add a medication"
                onKeyDown={(e) => e.key === 'Enter' && addMed()} />
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
