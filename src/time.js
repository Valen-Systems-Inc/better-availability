const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HUMAN_TIME_RE = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/i;
const BARE_HOUR_RE = /^(\d{1,2})$/;
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

export const dayAliases = {
  sun: "sunday",
  sunday: "sunday",
  mon: "monday",
  monday: "monday",
  tue: "tuesday",
  tues: "tuesday",
  tuesday: "tuesday",
  wed: "wednesday",
  weds: "wednesday",
  wednesday: "wednesday",
  thu: "thursday",
  thur: "thursday",
  thurs: "thursday",
  thursday: "thursday",
  fri: "friday",
  friday: "friday",
  sat: "saturday",
  saturday: "saturday"
};

export function normalizeDay(value) {
  const normalized = dayAliases[String(value || "").trim().toLowerCase()];
  if (!normalized) {
    throw new Error(`Expected a day like monday, mon, friday, or fri. Received ${value}`);
  }
  return normalized;
}

export function expandDayRange(start, end) {
  const startDay = normalizeDay(start);
  const endDay = normalizeDay(end);
  const startIndex = dayNames.indexOf(startDay);
  const endIndex = dayNames.indexOf(endDay);

  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not expand day range ${start} through ${end}`);
  }

  if (startIndex <= endIndex) {
    return dayNames.slice(startIndex, endIndex + 1);
  }

  return [...dayNames.slice(startIndex), ...dayNames.slice(0, endIndex + 1)];
}

export function assertDate(value) {
  if (!DATE_RE.test(value)) {
    throw new Error(`Expected date in YYYY-MM-DD format, received ${value}`);
  }
}

export function todayString(offsetDays = 0, now = new Date()) {
  const local = new Date(now);
  local.setDate(local.getDate() + offsetDays);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDate(value, now = new Date()) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "today") {
    return todayString(0, now);
  }
  if (normalized === "tomorrow") {
    return todayString(1, now);
  }
  return value;
}

export function parseMinutes(value) {
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  const match = TIME_RE.exec(normalized);
  if (!match) {
    const bareHour = BARE_HOUR_RE.exec(normalized);
    if (bareHour) {
      const hours = Number(bareHour[1]);
      if (hours < 0 || hours > 23) {
        throw new Error(`Expected hour between 0 and 23. Received ${value}`);
      }
      return hours * 60;
    }

    const humanMatch = HUMAN_TIME_RE.exec(normalized);

    if (!humanMatch) {
      throw new Error(`Expected time like 09:00, 13:30, 9am, or 1:30pm. Received ${value}`);
    }

    let hours = Number(humanMatch[1]);
    const mins = Number(humanMatch[2] || "0");
    const period = humanMatch[3].toLowerCase();

    if (hours < 1 || hours > 12) {
      throw new Error(`Expected 12-hour time between 1 and 12. Received ${value}`);
    }

    if (period === "am" && hours === 12) {
      hours = 0;
    } else if (period === "pm" && hours !== 12) {
      hours += 12;
    }

    return hours * 60 + mins;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeTime(value) {
  return formatMinutes(parseMinutes(value));
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
