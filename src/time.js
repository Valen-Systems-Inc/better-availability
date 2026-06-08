const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

export function assertDate(value) {
  if (!DATE_RE.test(value)) {
    throw new Error(`Expected date in YYYY-MM-DD format, received ${value}`);
  }
}

export function parseMinutes(value) {
  const match = TIME_RE.exec(value);
  if (!match) {
    throw new Error(`Expected time in HH:mm 24-hour format, received ${value}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutes(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatLocal(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return formatter.format(date);
}

export function validateTimeZone(timeZone) {
  if (timeZone !== "UTC" && !String(timeZone).includes("/")) {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

export function dayNameForDate(date) {
  assertDate(date);
  const [year, month, day] = date.split("-").map(Number);
  return dayNames[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function getTimeZoneOffsetMs(timeZone, instant) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );

  return asUtc - instant.getTime();
}

export function zonedTimeToUtc(date, time, timeZone) {
  assertDate(date);
  validateTimeZone(timeZone);
  const [year, month, day] = date.split("-").map(Number);
  const minutes = parseMinutes(time);
  const wallClockGuess = new Date(Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60));
  const firstOffset = getTimeZoneOffsetMs(timeZone, wallClockGuess);
  const firstUtc = new Date(wallClockGuess.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(timeZone, firstUtc);

  if (firstOffset === secondOffset) {
    return firstUtc;
  }

  return new Date(wallClockGuess.getTime() - secondOffset);
}

export function addDays(date, count) {
  assertDate(date);
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return next.toISOString().slice(0, 10);
}

export function localDateRange(startDate, days) {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("days must be a positive integer");
  }

  return Array.from({ length: days }, (_, index) => addDays(startDate, index));
}
