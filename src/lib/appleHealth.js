// Parses the export.xml file from the iPhone Health app
// (Health app → profile photo → "Export All Health Data" → unzip → export.xml).
//
// We pull the records relevant to a GLP-1 program and bucket them per day,
// only inside the requested [start, end] window so a huge multi-year export
// still imports quickly.
//
// Returns:
//   { weights: [{logged_at, weight_kg}],
//     activities: [{started_at, type, duration_min, distance_km, energy_kcal, steps}] }

function attr(tag, name) {
  // tag is a raw "<Record .../>" string; read one attribute safely.
  const m = tag.match(new RegExp(`${name}="([^"]*)"`))
  return m ? m[1] : null
}

// Apple exports dates as "2026-06-11 08:00:00 +0530".
// Convert to an ISO string the Date constructor parses correctly.
function parseAppleDate(s) {
  if (!s) return new Date(NaN)
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})?$/
  )
  if (m) {
    const tz = m[4] ? `${m[3]}:${m[4]}` : `${m[3]}:00`
    return new Date(`${m[1]}T${m[2]}${tz}`)
  }
  return new Date(s)
}

function inWindow(d, start, end) {
  const t = d.getTime()
  return t >= start.getTime() && t <= end.getTime()
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function parseAppleHealthExport(xmlText, start, end) {
  // Daily buckets keyed by date.
  const steps = {} // dayKey -> total steps
  const energy = {} // dayKey -> active kcal
  const distance = {} // dayKey -> km
  const weights = [] // individual body-mass readings
  const workouts = [] // individual workouts

  // Health exports are large; iterate over Record / Workout tags with a regex
  // sweep rather than building a full DOM.
  const recordRe = /<Record\b[^>]*\/?>/g
  let m
  while ((m = recordRe.exec(xmlText)) !== null) {
    const tag = m[0]
    const type = attr(tag, 'type')
    if (!type) continue
    const startStr = attr(tag, 'startDate')
    if (!startStr) continue
    const date = parseAppleDate(startStr)
    if (isNaN(date) || !inWindow(date, start, end)) continue
    const value = parseFloat(attr(tag, 'value'))
    if (isNaN(value)) continue
    const k = dayKey(date)

    if (type === 'HKQuantityTypeIdentifierStepCount') {
      steps[k] = (steps[k] || 0) + value
    } else if (type === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
      energy[k] = (energy[k] || 0) + value
    } else if (type === 'HKQuantityTypeIdentifierDistanceWalkingRunning') {
      // Apple usually exports this in km; if in miles unit, convert.
      const unit = attr(tag, 'unit') || 'km'
      const km = unit.toLowerCase().startsWith('mi') ? value * 1.60934 : value
      distance[k] = (distance[k] || 0) + km
    } else if (type === 'HKQuantityTypeIdentifierBodyMass') {
      const unit = (attr(tag, 'unit') || 'kg').toLowerCase()
      let kg = value
      if (unit.startsWith('lb')) kg = value * 0.453592
      weights.push({ logged_at: date.toISOString(), weight_kg: round(kg, 2) })
    }
  }

  const workoutRe = /<Workout\b[^>]*\/?>/g
  while ((m = workoutRe.exec(xmlText)) !== null) {
    const tag = m[0]
    const startStr = attr(tag, 'startDate')
    if (!startStr) continue
    const date = parseAppleDate(startStr)
    if (isNaN(date) || !inWindow(date, start, end)) continue
    const activityType = (attr(tag, 'workoutActivityType') || '').replace(
      'HKWorkoutActivityType',
      ''
    )
    const duration = parseFloat(attr(tag, 'duration')) // minutes (default unit)
    const dist = parseFloat(attr(tag, 'totalDistance'))
    const kcal = parseFloat(attr(tag, 'totalEnergyBurned'))
    workouts.push({
      started_at: date.toISOString(),
      type: mapWorkoutType(activityType),
      duration_min: isNaN(duration) ? null : round(duration, 1),
      distance_km: isNaN(dist) ? null : round(dist, 2),
      energy_kcal: isNaN(kcal) ? null : round(kcal, 0),
      steps: null,
      source: 'healthkit',
    })
  }

  // Turn the daily step/energy/distance buckets into one "daily" activity row each.
  const dailyActivities = []
  const allDays = new Set([
    ...Object.keys(steps),
    ...Object.keys(energy),
    ...Object.keys(distance),
  ])
  for (const k of allDays) {
    const [y, mo, da] = k.split('-').map(Number)
    const noon = new Date(y, mo, da, 12, 0, 0)
    dailyActivities.push({
      started_at: noon.toISOString(),
      type: 'daily',
      duration_min: null,
      distance_km: distance[k] ? round(distance[k], 2) : null,
      energy_kcal: energy[k] ? round(energy[k], 0) : null,
      steps: steps[k] ? Math.round(steps[k]) : null,
      source: 'healthkit',
    })
  }

  return {
    weights,
    activities: [...dailyActivities, ...workouts],
  }
}

function mapWorkoutType(t) {
  const s = (t || '').toLowerCase()
  if (s.includes('walk')) return 'walk'
  if (s.includes('cycl') || s.includes('bik')) return 'cycle'
  if (s.includes('run')) return 'run'
  if (s.includes('strength') || s.includes('training')) return 'strength'
  if (s.includes('swim')) return 'swim'
  return t || 'other'
}

function round(n, places) {
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}
