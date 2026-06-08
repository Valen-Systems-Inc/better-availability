import { dayNames, normalizeTime, parseMinutes, validateTimeZone } from "./time.js";

const daySet = new Set(dayNames);
const dayAliases = {
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

export function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createProfile({ name, timeZone, role = "", tags = [] }) {
  if (!name || !name.trim()) {
    throw new Error("name is required");
  }

  validateTimeZone(timeZone);

  return {
    schemaVersion: 1,
    id: slugify(name),
    name: name.trim(),
    role,
    tags,
    timeZone,
    baseAvailability: [],
    addedAvailability: [],
    blockedAvailability: []
  };
}

export function normalizeWindow(window, mode = "base") {
  if (!window || typeof window !== "object") {
    throw new Error("availability window must be an object");
  }

  const normalized = {
    start: normalizeTime(window.start),
    end: normalizeTime(window.end)
  };

  const startMinutes = parseMinutes(normalized.start);
  const endMinutes = parseMinutes(normalized.end);

  if (endMinutes <= startMinutes) {
    throw new Error(`availability window must end after it starts: ${normalized.start}-${normalized.end}`);
  }

  if (mode === "base") {
    const day = dayAliases[String(window.day || "").trim().toLowerCase()];
    if (!daySet.has(day)) {
      throw new Error(`base availability requires a valid day like monday or mon. Received ${window.day}`);
    }
    normalized.day = day;
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(window.date || "")) {
      throw new Error(`override availability requires YYYY-MM-DD date, received ${window.date}`);
    }
    normalized.date = window.date;
  }

  return normalized;
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== "object") {
    throw new Error("profile must be an object");
  }

  for (const field of ["schemaVersion", "id", "name", "timeZone"]) {
    if (profile[field] === undefined || profile[field] === "") {
      throw new Error(`profile missing required field: ${field}`);
    }
  }

  if (profile.schemaVersion !== 1) {
    throw new Error(`unsupported profile schemaVersion: ${profile.schemaVersion}`);
  }

  validateTimeZone(profile.timeZone);

  return {
    schemaVersion: 1,
    id: slugify(profile.id),
    name: String(profile.name),
    role: profile.role ? String(profile.role) : "",
    tags: Array.isArray(profile.tags) ? profile.tags.map(String) : [],
    timeZone: profile.timeZone,
    baseAvailability: (profile.baseAvailability || []).map((window) => normalizeWindow(window, "base")),
    addedAvailability: (profile.addedAvailability || []).map((window) => normalizeWindow(window, "override")),
    blockedAvailability: (profile.blockedAvailability || []).map((window) => normalizeWindow(window, "override"))
  };
}

export function addBaseAvailability(profile, window) {
  const next = validateProfile(profile);
  next.baseAvailability.push(normalizeWindow(window, "base"));
  return next;
}

export function addAvailability(profile, window) {
  const next = validateProfile(profile);
  next.addedAvailability.push(normalizeWindow(window, "override"));
  return next;
}

export function blockAvailability(profile, window) {
  const next = validateProfile(profile);
  next.blockedAvailability.push(normalizeWindow(window, "override"));
  return next;
}
