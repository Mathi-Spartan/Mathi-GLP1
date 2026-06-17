// Date helpers for the Tuesday-to-Tuesday reporting cycle.
// Tuesday = day 2 (Sun=0, Mon=1, Tue=2 ...).

const DAY = 24 * 60 * 60 * 1000

// The next Tuesday on or after `from` (today by default).
export function nextTuesday(from = new Date()) {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  const delta = (2 - d.getDay() + 7) % 7 // 0 if already Tuesday
  d.setDate(d.getDate() + delta)
  return d
}

// The most recent Tuesday on or before `from`.
export function lastTuesday(from = new Date()) {
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  const delta = (d.getDay() - 2 + 7) % 7
  d.setDate(d.getDate() - delta)
  return d
}

// Report window for an appointment date: the 7 days ending ON the
// appointment Tuesday, i.e. [appt - 7 days, appt]. We include the full
// appointment day, so `end` is the moment just before the next midnight.
export function reportWindow(appointmentDate) {
  const end = new Date(appointmentDate)
  end.setHours(23, 59, 59, 999)
  const start = new Date(appointmentDate)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 7)
  return { start, end }
}

// Array of the 7 day-buckets (Date at midnight) inside a window's last week.
export function weekDays(appointmentDate) {
  const days = []
  const base = new Date(appointmentDate)
  base.setHours(0, 0, 0, 0)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    days.push(d)
  }
  return days
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function fmtDate(d) {
  return new Date(d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function fmtDateLong(d) {
  return new Date(d).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function toISODate(d) {
  const x = new Date(d)
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Array of `count` week windows ending on `anchorDate`, going backward.
// index 0 is the most recent (anchorDate itself), index 1 is the week
// before that, etc. `offset` skips that many windows before starting —
// used for "load earlier weeks" pagination.
export function weekWindowsBack(anchorDate, count, offset = 0) {
  const windows = []
  for (let i = offset; i < offset + count; i++) {
    const end = new Date(anchorDate)
    end.setDate(end.getDate() - i * 7)
    windows.push(reportWindow(end))
  }
  return windows
}

export { DAY }
