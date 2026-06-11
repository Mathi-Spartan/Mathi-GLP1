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

const QUICK = [
  { type: 'weight', icon: '⚖️', label: 'Weight' },
  { type: 'injection', icon: '💉', label: 'Injection' },
  { type: 'meal', icon: '🍽️', label: 'Food' },
  { type: 'water', icon: '💧', label: 'Water' },
  { type: 'activity', icon: '🚶', label: 'Activity' },
  { type: 'symptom', icon: '🩺', label: 'Side effect' },
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
    return <div className="auth-wrap muted">Loading your week…</div>
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <div>
            <h1>Weekly Health Tracker</h1>
            <small>{profile?.full_name || session.user.email}</small>
          </div>
        </div>
        <div className="row" style={{ flex: '0 0 auto' }}>
          <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>Settings</button>
          <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>

      {toast && <div className={`notice ${toast.type}`}>{toast.text}</div>}

      <WeeklyBand data={data} appointment={appointment} />

      <Metrics data={data} />

      <div className="card">
        <h2>Log something</h2>
        <div className="sub">One tap. Add the time if it wasn't just now.</div>
        <div className="quicklog">
          {QUICK.map((q) => (
            <button key={q.type} className="ql" onClick={() => setOpenLog(q.type)}>
              <span className="qi">{q.icon}</span>
              <span className="qt">{q.label}</span>
            </button>
          ))}
        </div>
      </div>

      <MedsCard userId={userId} meds={data.medications} onLogged={loadData} flash={flash} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Weight this week</h2>
          <div className="sub">Tuesday to Tuesday</div>
          <WeightChart weights={data.weights} prevWeight={data.prevWeight} />
        </div>
        <AppleHealthCard userId={userId} window={window} onImported={loadData} flash={flash} />
      </div>

      <RecentLogs data={data} />

      <div className="card center">
        <h2>Doctor's report</h2>
        <div className="sub">
          Everything from {fmtDate(window.start)} to {fmtDate(window.end)} as a single PDF.
        </div>
        <button
          className="btn btn-amber"
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
    <div className="card">
      <h2>Medications</h2>
      <div className="sub">Tap when you take one. Add your medications in Settings.</div>
      <div className="quicklog">
        {meds.map((m) => (
          <button key={m.id} className="ql" onClick={() => take(m)}>
            <span className="qi">💊</span>
            <span className="qt">{m.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---------------- weekly band (signature element) ---------------- */
function WeeklyBand({ data, appointment }) {
  const appt = new Date(appointment.appointment_date + 'T12:00:00')
  const days = weekDays(appt)
  const today = new Date()

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
    <div className="weekband">
      <div className="weekband-top">
        <h2>This cycle</h2>
        <span>Injection day: {fmtDate(appt)}</span>
      </div>
      <div className="days">
        {days.map((day) => {
          const isToday = sameDay(day, today)
          const isAppt = sameDay(day, appt)
          return (
            <div key={day.toISOString()} className={`day${isToday ? ' today' : ''}${isAppt ? ' appt' : ''}`}>
              <div className="dn">{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
              <div className="dd">{day.getDate()}</div>
              <div className="dots">
                {dotsFor(day).map((d, i) => (
                  <span key={i} className={`dot ${d}`} />
                ))}
              </div>
              {isAppt && <div className="appt-pill">Doctor</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- metrics ---------------- */
function Metrics({ data }) {
  const sorted = [...data.weights].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  const last = sorted[sorted.length - 1]?.weight_kg
  const base = data.prevWeight ?? sorted[0]?.weight_kg
  let delta = null
  if (last != null && base != null) delta = last - base

  const stepDays = data.activities.filter((a) => a.steps != null)
  const avgSteps = stepDays.length
    ? Math.round(stepDays.reduce((s, a) => s + a.steps, 0) / stepDays.length)
    : null
  const water = data.water.reduce((s, w) => s + (w.amount_ml || 0), 0)

  const cards = [
    { label: 'Current weight', value: last != null ? `${last.toFixed(1)} kg` : '—' },
    {
      label: 'Change this week',
      value: delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg` : '—',
      cls: delta == null ? '' : delta <= 0 ? 'down' : 'up',
    },
    { label: 'Avg steps / day', value: avgSteps != null ? avgSteps.toLocaleString() : '—' },
    { label: 'Side effects', value: String(data.symptoms.length) },
  ]
  return (
    <div className="metrics">
      {cards.map((c) => (
        <div key={c.label} className="metric">
          <div className="ml">{c.label}</div>
          <div className={`mv ${c.cls || ''}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}

/* ---------------- weight chart (dependency-free SVG) ---------------- */
function WeightChart({ weights, prevWeight }) {
  const points = [...weights].sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  if (prevWeight != null) {
    points.unshift({ weight_kg: prevWeight, logged_at: null, baseline: true })
  }
  if (points.length < 2) {
    return <div className="empty">Log your weight a couple of times to see the trend.</div>
  }
  const W = 520
  const H = 160
  const pad = { l: 38, r: 12, t: 14, b: 24 }
  const vals = points.map((p) => p.weight_kg)
  const min = Math.min(...vals) - 0.5
  const max = Math.max(...vals) + 0.5
  const x = (i) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r)
  const y = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (H - pad.t - pad.b)
  const poly = points.map((p, i) => `${x(i)},${y(p.weight_kg)}`).join(' ')

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} />
      <text x={2} y={y(max) + 4}>{max.toFixed(1)}</text>
      <text x={2} y={y(min) + 4}>{min.toFixed(1)}</text>
      <polyline points={poly} />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.weight_kg)} r={3} />
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
    <div className="card">
      <h2>Apple Health</h2>
      <div className="sub">
        On your iPhone: Health app → your photo → "Export All Health Data". Unzip it and upload the
        <strong> export.xml</strong> file here. Only this week's data is imported.
      </div>
      <input ref={fileRef} type="file" accept=".xml" onChange={handleFile} style={{ display: 'none' }} />
      <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>
        {busy ? 'Reading file…' : 'Upload export.xml'}
      </button>
    </div>
  )
}

/* ---------------- recent logs ---------------- */
function RecentLogs({ data }) {
  const items = []
  const push = (arr, tf, render, tag, cls) =>
    arr.forEach((r) => items.push({ t: new Date(r[tf]), text: render(r), tag, cls }))

  push(data.injections, 'injected_at', (r) => `${r.drug || 'Injection'} ${r.dose_mg ? r.dose_mg + ' mg' : ''}`, 'Injection', 'amber')
  push(data.weights.filter((w) => w.source !== 'healthkit'), 'logged_at', (r) => `${r.weight_kg} kg`, 'Weight')
  push(data.meals, 'eaten_at', (r) => `${r.meal_type}: ${r.description || ''}`, 'Food')
  push(data.symptoms, 'occurred_at', (r) => `${r.type}${r.severity ? ` (severity ${r.severity})` : ''}`, 'Side effect', 'amber')
  push(data.activities.filter((a) => a.source !== 'healthkit'), 'started_at', (r) => `${r.type}${r.duration_min ? ` · ${r.duration_min} min` : ''}`, 'Activity')
  push(data.water, 'logged_at', (r) => `${r.amount_ml} ml water`, 'Water')

  items.sort((a, b) => b.t - a.t)
  const top = items.slice(0, 12)

  return (
    <div className="card">
      <h2>Recent entries</h2>
      <div className="sub">Your manual logs this cycle. Apple Health data is summarised above and in the PDF.</div>
      {top.length === 0 ? (
        <div className="empty">Nothing logged yet this cycle. Use the buttons above to start.</div>
      ) : (
        <ul className="loglist">
          {top.map((it, i) => (
            <li key={i}>
              <span>
                <span className={`tag ${it.cls || ''}`}>{it.tag}</span> {it.text}
              </span>
              <span className="lt">{it.t.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
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
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <label>Your name (shown on the doctor's report)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <div className="spacer" />
        <div className="row">
          <div>
            <label>Height (cm)</label>
            <input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
          <div>
            <label>GLP-1 medication</label>
            <input value={drug} onChange={(e) => setDrug(e.target.value)} placeholder="e.g. Semaglutide" />
          </div>
        </div>
        <div className="spacer" />
        <label>Next appointment (your Tuesday)</label>
        <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
        <div className="spacer" />
        <label>Doctor's name (optional)</label>
        <input value={clinician} onChange={(e) => setClinician(e.target.value)} />

        <div className="spacer" />
        <div className="spacer" />
        <label>Your other medications</label>
        {meds.length > 0 && (
          <ul className="loglist" style={{ marginBottom: 8 }}>
            {meds.map((m) => (
              <li key={m.id}><span>{m.name}</span></li>
            ))}
          </ul>
        )}
        <div className="row">
          <input value={newMed} onChange={(e) => setNewMed(e.target.value)} placeholder="Add a medication" />
          <button className="btn" onClick={addMed}>Add</button>
        </div>

        <div className="actions">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
