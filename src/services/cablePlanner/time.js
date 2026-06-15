// Business-hours arithmetic over a machine's daily shift window.
// Ported from the planner's addBusinessHours / subtractBusinessHours / workingStart.
// All math in local time (the plant runs Asia/Kolkata; the browser is local).

const MS_HOUR = 3600 * 1000;
const GUARD = 5000; // iteration safety cap (matches planner)

function shiftWindow(machine) {
  const start = machine.shiftStartHour ?? 9;
  const len = machine.shiftHrs ?? 8;
  return { start, end: start + len };
}

// daysPerWeek: 6 → skip Sunday; 5 → skip Sat+Sun; else every day.
export function isWorkingDay(date, machine) {
  const d = date.getDay(); // 0=Sun … 6=Sat
  const dpw = machine.daysPerWeek ?? 6;
  if (dpw <= 5) return d !== 0 && d !== 6;
  if (dpw === 6) return d !== 0;
  return true;
}

const hourOf = (date) => date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;

function atHour(date, hour) {
  const d = new Date(date);
  const whole = Math.floor(hour);
  const mins = Math.round((hour - whole) * 60);
  d.setHours(whole, mins, 0, 0);
  return d;
}
function nextDayStart(date, machine) {
  const { start } = shiftWindow(machine);
  let d = atHour(date, start);
  d.setDate(d.getDate() + 1);
  let guard = 0;
  while (!isWorkingDay(d, machine) && guard++ < GUARD) d.setDate(d.getDate() + 1);
  return d;
}
function prevDayEnd(date, machine) {
  const { end } = shiftWindow(machine);
  let d = atHour(date, end);
  d.setDate(d.getDate() - 1);
  let guard = 0;
  while (!isWorkingDay(d, machine) && guard++ < GUARD) d.setDate(d.getDate() - 1);
  return d;
}

// Snap a date forward to the next valid moment inside a working shift window.
export function workingStart(date, machine) {
  const { start, end } = shiftWindow(machine);
  let d = new Date(date);
  let guard = 0;
  while (guard++ < GUARD) {
    if (!isWorkingDay(d, machine)) { d = atHour(nextDayStart(d, machine), start); continue; }
    const h = hourOf(d);
    if (h < start) { d = atHour(d, start); continue; }
    if (h >= end) { d = nextDayStart(d, machine); continue; }
    return d;
  }
  return d;
}

// Add `hours` of working time, flowing across shift windows / days.
export function addBusinessHours(start, hours, machine) {
  const { end } = shiftWindow(machine);
  let remaining = Math.max(0, hours);
  let cur = workingStart(start, machine);
  let guard = 0;
  while (remaining > 1e-9 && guard++ < GUARD) {
    const avail = end - hourOf(cur);
    if (avail <= 1e-9) { cur = workingStart(nextDayStart(cur, machine), machine); continue; }
    const used = Math.min(avail, remaining);
    cur = new Date(cur.getTime() + used * MS_HOUR);
    remaining -= used;
    if (remaining > 1e-9) cur = workingStart(nextDayStart(cur, machine), machine);
  }
  return cur;
}

// Subtract `hours` of working time (for reverse scheduling from a due date).
export function subtractBusinessHours(end, hours, machine) {
  const { start } = shiftWindow(machine);
  let remaining = Math.max(0, hours);
  // snap end back into a window
  let cur = new Date(end);
  let guard = 0;
  while (guard++ < GUARD) {
    if (!isWorkingDay(cur, machine)) { cur = prevDayEnd(cur, machine); continue; }
    const h = hourOf(cur);
    if (h > shiftWindow(machine).end) { cur = atHour(cur, shiftWindow(machine).end); continue; }
    if (h <= start) { cur = prevDayEnd(cur, machine); continue; }
    break;
  }
  guard = 0;
  while (remaining > 1e-9 && guard++ < GUARD) {
    const avail = hourOf(cur) - start;
    if (avail <= 1e-9) { cur = prevDayEnd(cur, machine); continue; }
    const used = Math.min(avail, remaining);
    cur = new Date(cur.getTime() - used * MS_HOUR);
    remaining -= used;
    if (remaining > 1e-9) cur = prevDayEnd(cur, machine);
  }
  return cur;
}
