import { dayNameForDate, formatLocal, parseMinutes, zonedTimeToUtc } from "./time.js";
import { validateProfile } from "./profile.js";

function toMinuteWindow(window) {
  return {
    start: parseMinutes(window.start),
    end: parseMinutes(window.end),
    source: window
  };
}

function mergeWindows(windows) {
  const sorted = [...windows].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];

  for (const window of sorted) {
    const previous = merged.at(-1);
    if (!previous || window.start > previous.end) {
      merged.push({ ...window });
    } else {
      previous.end = Math.max(previous.end, window.end);
    }
  }

  return merged;
}

function subtractWindow(window, block) {
  if (block.end <= window.start || block.start >= window.end) {
    return [window];
  }

  const pieces = [];
  if (block.start > window.start) {
    pieces.push({ ...window, end: block.start });
  }
  if (block.end < window.end) {
    pieces.push({ ...window, start: block.end });
  }
  return pieces;
}

function subtractWindows(windows, blocks) {
  let remaining = windows;

  for (const block of blocks) {
    remaining = remaining.flatMap((window) => subtractWindow(window, block));
  }

  return remaining;
}

export function effectiveLocalWindows(profileInput, date) {
  const profile = validateProfile(profileInput);
  const day = dayNameForDate(date);
  const base = profile.baseAvailability
    .filter((window) => window.day === day)
    .map(toMinuteWindow);
  const additions = profile.addedAvailability
    .filter((window) => window.date === date)
    .map(toMinuteWindow);
  const blocks = profile.blockedAvailability
    .filter((window) => window.date === date)
    .map(toMinuteWindow);

  return subtractWindows(mergeWindows([...base, ...additions]), mergeWindows(blocks))
    .map((window) => ({
      date,
      start: window.start,
      end: window.end,
      profile
    }));
}

export function effectiveUtcWindows(profileInput, date) {
  const profile = validateProfile(profileInput);

  return effectiveLocalWindows(profile, date).map((window) => ({
    profile,
    date,
    start: zonedTimeToUtc(date, minutesToTime(window.start), profile.timeZone),
    end: zonedTimeToUtc(date, minutesToTime(window.end), profile.timeZone)
  }));
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function intersectTwo(aWindows, bWindows) {
  const intersections = [];

  for (const a of aWindows) {
    for (const b of bWindows) {
      const startMs = Math.max(a.start.getTime(), b.start.getTime());
      const endMs = Math.min(a.end.getTime(), b.end.getTime());

      if (endMs > startMs) {
        intersections.push({
          start: new Date(startMs),
          end: new Date(endMs)
        });
      }
    }
  }

  return intersections;
}

export function findOverlapWindows(profileInputs, { date, durationMinutes = 30 }) {
  if (!Array.isArray(profileInputs) || profileInputs.length === 0) {
    throw new Error("at least one profile is required");
  }

  const profiles = profileInputs.map(validateProfile);
  let overlap = effectiveUtcWindows(profiles[0], date).map(({ start, end }) => ({ start, end }));

  for (const profile of profiles.slice(1)) {
    overlap = intersectTwo(overlap, effectiveUtcWindows(profile, date));
  }

  const minimumMs = durationMinutes * 60 * 1000;

  return overlap
    .filter((window) => window.end.getTime() - window.start.getTime() >= minimumMs)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((window) => ({
      start: window.start,
      end: window.end,
      durationMinutes: Math.round((window.end.getTime() - window.start.getTime()) / 60000),
      localTimes: profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        timeZone: profile.timeZone,
        start: formatLocal(window.start, profile.timeZone),
        end: formatLocal(window.end, profile.timeZone)
      }))
    }));
}
