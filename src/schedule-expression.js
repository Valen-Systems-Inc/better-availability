import {
  addDays,
  assertDate,
  dayNames,
  expandDayRange,
  normalizeDate,
  normalizeDay,
  normalizeTime
} from "./time.js";

function clean(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function splitOnce(text, pattern) {
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index;
  const end = start + match[0].length;
  return {
    left: text.slice(0, start).trim(),
    right: text.slice(end).trim(),
    match
  };
}

function parseDayList(text) {
  const normalized = clean(text)
    .replace(/\band\b/g, ",")
    .replace(/\s*,\s*/g, ",");
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Could not understand day expression: ${text}`);
  }
  return [...new Set(parts.map((part) => normalizeDay(part)))];
}

export function parseDayExpression(input) {
  const text = clean(input)
    .replace(/\bevery day\b/g, "all days")
    .replace(/\ball day\b/g, "all days");

  if (text === "weekdays") {
    return ["monday", "tuesday", "wednesday", "thursday", "friday"];
  }
  if (text === "weekends") {
    return ["saturday", "sunday"];
  }
  if (text === "all days") {
    return [...dayNames];
  }

  const rangeMatch = text.match(/^([a-z]+)\s*(?:through|to|-)\s*([a-z]+)$/);
  if (rangeMatch) {
    return expandDayRange(rangeMatch[1], rangeMatch[2]);
  }

  return parseDayList(text);
}

function parseSingleWindow(text) {
  const normalized = clean(text);
  let match = normalized.match(/^(.+?)\s+to\s+(.+)$/);
  if (!match) {
    match = normalized.match(/^(.+?)-(.+)$/);
  }
  if (!match) {
    throw new Error(`Could not understand time window: ${text}`);
  }

  return {
    start: normalizeTime(match[1]),
    end: normalizeTime(match[2])
  };
}

export function parseTimeWindowExpression(input) {
  const text = clean(input).replace(/\s*,\s*/g, " and ");
  return text
    .split(/\band\b/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseSingleWindow(part));
}

export function parseScheduleExpression(input) {
  const text = clean(input);
  const dayFirst = splitOnce(text, /\s(?=(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{2}:\d{2}))/);
  if (!dayFirst) {
    throw new Error("Describe availability as days followed by time windows, for example `weekdays 8am to 9pm`.");
  }

  return {
    days: parseDayExpression(dayFirst.left),
    windows: parseTimeWindowExpression(dayFirst.right)
  };
}

function parseDateToken(text, now = new Date()) {
  const normalized = normalizeDate(text, now);
  assertDate(normalized);
  return normalized;
}

export function parseDateExpression(input, now = new Date()) {
  const text = clean(input);
  if (text === "today" || text === "tomorrow" || /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return [parseDateToken(text, now)];
  }

  if (/^[a-z]+(?:\s*(?:through|to|-)\s*[a-z]+)?$/.test(text) || text.includes(",") || text.includes(" and ")) {
    const days = parseDayExpression(text);
    return days.map((day) => {
      const today = new Date(now);
      const todayIndex = today.getDay();
      const targetIndex = dayNames.indexOf(day);
      const delta = (targetIndex - todayIndex + 7) % 7;
      return addDays(normalizeDate("today", now), delta);
    });
  }

  throw new Error(`Could not understand date expression: ${input}`);
}

export function parseOneTimeAvailabilityExpression(input, now = new Date()) {
  const text = clean(input);
  const dateFirst = splitOnce(text, /\s(?=(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{2}:\d{2}))/);
  if (!dateFirst) {
    throw new Error("Describe one-time availability as a date followed by time, for example `today 6pm to 8pm`.");
  }

  return {
    dates: parseDateExpression(dateFirst.left, now),
    windows: parseTimeWindowExpression(dateFirst.right)
  };
}
