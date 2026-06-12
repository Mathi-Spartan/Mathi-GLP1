import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Field definitions per log type keep the form code small and consistent.
export const LOG_TYPES = {
  weight: {
    title: 'Log weight',
    hint: 'Best taken at the same time each day.',
    table: 'weight_logs',
    timeField: 'logged_at',
    fields: [{ key: 'weight_kg', label: 'Weight (kg)', type: 'number', required: true }],
  },
  injection: {
    title: 'Log GLP-1 injection',
    hint: 'Your weekly dose.',
    table: 'injections',
    timeField: 'injected_at',
    fields: [
      { key: 'drug', label: 'Medication', type: 'text', placeholder: 'e.g. Semaglutide' },
      { key: 'dose_mg', label: 'Dose (mg)', type: 'number', placeholder: 'e.g. 0.25' },
      { key: 'site', label: 'Injection site', type: 'select', options: ['Abdomen', 'Thigh', 'Upper arm'] },
      { key: 'lot', label: 'Lot / batch (optional)', type: 'text' },
      { key: 'notes', label: 'Notes (optional)', type: 'textarea' },
    ],
  },
  meal: {
    title: 'Log food',
    hint: 'Quick note is enough — detail helps your doctor.',
    table: 'meals',
    timeField: 'eaten_at',
    fields: [
      { key: 'meal_type', label: 'Meal', type: 'select', options: ['breakfast', 'lunch', 'dinner', 'snack'] },
      { key: 'description', label: 'What did you eat?', type: 'textarea', required: true },
      { key: 'calories', label: 'Calories (optional)', type: 'number' },
      { key: 'protein_g', label: 'Protein in grams (optional)', type: 'number' },
    ],
  },
  water: {
    title: 'Log water',
    hint: 'Tap a quick amount or type your own.',
    table: 'water_logs',
    timeField: 'logged_at',
    quick: [250, 500, 750, 1000],
    fields: [{ key: 'amount_ml', label: 'Amount (ml)', type: 'number', required: true }],
  },
  activity: {
    title: 'Log activity',
    hint: 'Walks count too.',
    table: 'activities',
    timeField: 'started_at',
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: ['walk', 'cycle', 'run', 'strength', 'swim', 'other'] },
      { key: 'duration_min', label: 'Duration (minutes)', type: 'number' },
      { key: 'distance_km', label: 'Distance (km, optional)', type: 'number' },
      { key: 'steps', label: 'Steps (optional)', type: 'number' },
      { key: 'energy_kcal', label: 'Energy burned (kcal, optional)', type: 'number' },
    ],
  },
  symptom: {
    title: 'Log side effect',
    hint: 'Track how the medication makes you feel.',
    table: 'symptoms',
    timeField: 'occurred_at',
    fields: [
      { key: 'type', label: 'What are you feeling?', type: 'select', options: ['nausea', 'fatigue', 'stomach / GI', 'headache', 'dizziness', 'reduced appetite', 'other'] },
      { key: 'severity', label: 'How strong is it?', type: 'severity', options: ['1', '2', '3', '4', '5'] },
      { key: 'notes', label: 'Notes (optional)', type: 'textarea' },
    ],
  },
  craving: {
    title: 'Log a craving',
    hint: 'GLP-1 often quiets food cravings — tracking this shows your doctor how well it is working.',
    table: 'symptoms',
    timeField: 'occurred_at',
    fixed: { type: 'craving' },
    fields: [
      { key: 'severity', label: 'How strong was the craving?', type: 'severity', options: ['1', '2', '3', '4', '5'] },
      { key: 'notes', label: 'What did you crave? (optional)', type: 'textarea', placeholder: 'e.g. sweets, late-night snacking, carbs' },
    ],
  },
  sleep: {
    title: 'Log sleep',
    hint: 'GLP-1 can affect sleep. Track it to show your doctor the full picture.',
    table: 'sleep_logs',
    timeField: 'logged_at',
    fields: [
      { key: 'hours', label: 'Hours slept', type: 'number', required: true, placeholder: 'e.g. 7.5' },
      { key: 'quality', label: 'Sleep quality', type: 'severity', options: ['1', '2', '3', '4', '5'] },
      { key: 'notes', label: 'Notes (optional)', type: 'textarea', placeholder: 'e.g. woke up twice, vivid dreams' },
    ],
  },
  mood: {
    title: 'Log energy & mood',
    hint: 'How are you feeling today overall?',
    table: 'mood_logs',
    timeField: 'logged_at',
    fields: [
      { key: 'score', label: 'How are you feeling?', type: 'severity', options: ['1', '2', '3', '4', '5'] },
      { key: 'notes', label: 'Notes (optional)', type: 'textarea', placeholder: 'e.g. tired, energetic, anxious' },
    ],
  },
}

const NUMERIC = new Set(['number'])

function nowLocal() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function LogModal({ type, userId, onClose, onSaved }) {
  const cfg = LOG_TYPES[type]
  const [values, setValues] = useState(() => {
    const init = {}
    cfg.fields.forEach((f) => {
      if (f.type === 'select') init[f.key] = f.options[0]
    })
    return init
  })
  const [when, setWhen] = useState(nowLocal())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  function set(key, v) {
    setValues((prev) => ({ ...prev, [key]: v }))
  }

  async function save() {
    setErr(null)
    for (const f of cfg.fields) {
      if (f.required && !values[f.key]) {
        setErr(`Please fill in "${f.label}".`)
        return
      }
    }
    const row = { user_id: userId, [cfg.timeField]: new Date(when).toISOString() }
    for (const f of cfg.fields) {
      let v = values[f.key]
      if (v === '' || v === undefined) v = null
      if (v !== null && NUMERIC.has(f.type)) v = Number(v)
      if (f.key === 'severity' && v !== null) v = Number(v)
      row[f.key] = v
    }
    if (cfg.fixed) Object.assign(row, cfg.fixed)
    setBusy(true)
    const { error } = await supabase.from(cfg.table).insert(row)
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-h">
          <h3>{cfg.title}</h3>
          {cfg.hint && <div className="sub">{cfg.hint}</div>}
        </div>

        <div className="sheet-body">
          {err && <div className="note err">{err}</div>}

          {cfg.quick && (
            <div className="chips">
              {cfg.quick.map((q) => (
                <button key={q} onClick={() => set('amount_ml', q)}>
                  +{q} ml
                </button>
              ))}
            </div>
          )}

          {cfg.fields.map((f) => (
            <div key={f.key} className="field">
              <label>{f.label}</label>

              {f.type === 'severity' ? (
                <>
                  <div className="scale">
                    {f.options.map((o) => (
                      <button
                        key={o}
                        className={`s${o}${String(values[f.key]) === o ? ' on' : ''}`}
                        onClick={() => set(f.key, o)}
                        type="button"
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                  <div className="scale-cap"><span>Mild</span><span>Severe</span></div>
                </>
              ) : f.type === 'select' ? (
                <div className="seg">
                  {f.options.map((o) => (
                    <button
                      key={o}
                      className={values[f.key] === o ? 'on' : ''}
                      onClick={() => set(f.key, o)}
                      type="button"
                    >
                      {o}
                    </button>
                  ))}
                </div>
              ) : f.type === 'textarea' ? (
                <textarea
                  rows={2}
                  value={values[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  inputMode={f.type === 'number' ? 'decimal' : undefined}
                  value={values[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </div>
          ))}

          <div className="field">
            <label>When</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
        </div>

        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
