import { dayNames, normalizeTime, parseMinutes, validateTimeZone } from "./time.js";

const daySet = new Set(dayNames);
const availabilityKinds = {
  base: {
    property: "baseAvailability",
    mode: "base",
    label: "Base availability"
  },
  added: {
    property: "addedAvailability",
    mode: "override",
    label: "Added availability"
  },
  blocked: {
    property: "blockedAvailability",
    mode: "override",
    label: "Blocked time"
  }
};
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

  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    id: slugify(name),
    name: name.trim(),
    role,
    tags,
    timeZone,
    createdAt: now,
    updatedAt: now,
    baseAvailability: [],
    addedAvailability: [],
    blockedAvailability: []
  };
}

export function normalizeAvailabilityKind(kind) {
  const normalized = String(kind || "").trim().toLowerCase();
  if (!availabilityKinds[normalized]) {
    throw new Error("availability kind must be base, added, or blocked");
  }
  return normalized;
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
    createdAt: profile.createdAt ? String(profile.createdAt) : undefined,
    updatedAt: profile.updatedAt ? String(profile.updatedAt) : undefined,
    baseAvailability: (profile.baseAvailability || []).map((window) => normalizeWindow(window, "base")),
    addedAvailability: (profile.addedAvailability || []).map((window) => normalizeWindow(window, "override")),
    blockedAvailability: (profile.blockedAvailability || []).map((window) => normalizeWindow(window, "override"))
  };
}

function markUpdated(profile) {
  return {
    ...profile,
    updatedAt: new Date().toISOString()
  };
}

function windowKey(window, kind) {
  return kind === "base" ? window.day : window.date;
}

function windowsOverlap(a, b) {
  const aStart = parseMinutes(a.start);
  const aEnd = parseMinutes(a.end);
  const bStart = parseMinutes(b.start);
  const bEnd = parseMinutes(b.end);
  return aStart < bEnd && bStart < aEnd;
}

export function findWindowConflict(profileInput, kindInput, windowInput, ignoreIndex = -1) {
  const profile = validateProfile(profileInput);
  const kind = normalizeAvailabilityKind(kindInput);
  const config = availabilityKinds[kind];
  const window = normalizeWindow(windowInput, config.mode);
  const windows = profile[config.property];

  return windows.find((existing, index) => {
    if (index === ignoreIndex) {
      return false;
    }
    return windowKey(existing, kind) === windowKey(window, kind) && windowsOverlap(existing, window);
  });
}

function assertNoWindowConflict(profile, kind, window, ignoreIndex = -1) {
  const conflict = findWindowConflict(profile, kind, window, ignoreIndex);
  if (!conflict) {
    return;
  }

  const key = kind === "base" ? conflict.day : conflict.date;
  throw new Error(
    `This window overlaps an existing ${kind} window: ${key} ${conflict.start}-${conflict.end}`
  );
}

export function listAvailabilityWindows(profileInput) {
  const profile = validateProfile(profileInput);
  const rows = [];

  for (const [kind, config] of Object.entries(availabilityKinds)) {
    profile[config.property].forEach((window, index) => {
      rows.push({
        number: rows.length + 1,
        kind,
        kindLabel: config.label,
        property: config.property,
        index,
        day: window.day,
        date: window.date,
        start: window.start,
        end: window.end
      });
    });
  }

  return rows;
}

export function getAvailabilityWindow(profileInput, kindInput, indexInput) {
  const profile = validateProfile(profileInput);
  const kind = normalizeAvailabilityKind(kindInput);
  const index = Number(indexInput);
  const config = availabilityKinds[kind];
  const window = profile[config.property][index];

  if (!Number.isInteger(index) || index < 0 || !window) {
    throw new Error(`No ${kind} availability window found at index ${indexInput}`);
  }

  return {
    kind,
    index,
    kindLabel: config.label,
    ...window
  };
}

export function addBaseAvailability(profile, window, options = {}) {
  const next = validateProfile(profile);
  const normalized = normalizeWindow(window, "base");
  if (!options.allowOverlap) {
    assertNoWindowConflict(next, "base", normalized);
  }
  next.baseAvailability.push(normalized);
  return markUpdated(next);
}

export function addAvailability(profile, window, options = {}) {
  const next = validateProfile(profile);
  const normalized = normalizeWindow(window, "override");
  if (!options.allowOverlap) {
    assertNoWindowConflict(next, "added", normalized);
  }
  next.addedAvailability.push(normalized);
  return markUpdated(next);
}

export function blockAvailability(profile, window, options = {}) {
  const next = validateProfile(profile);
  const normalized = normalizeWindow(window, "override");
  if (!options.allowOverlap) {
    assertNoWindowConflict(next, "blocked", normalized);
  }
  next.blockedAvailability.push(normalized);
  return markUpdated(next);
}

export function updateAvailabilityWindow(profileInput, ref, patch, options = {}) {
  const profile = validateProfile(profileInput);
  const fromKind = normalizeAvailabilityKind(ref.kind);
  const fromConfig = availabilityKinds[fromKind];
  const index = Number(ref.index);
  const existing = profile[fromConfig.property][index];

  if (!Number.isInteger(index) || index < 0 || !existing) {
    throw new Error(`No ${fromKind} availability window found at index ${ref.index}`);
  }

  const toKind = patch.kind ? normalizeAvailabilityKind(patch.kind) : fromKind;
  const toConfig = availabilityKinds[toKind];
  const candidate = normalizeWindow({ ...existing, ...patch }, toConfig.mode);

  if (!options.allowOverlap) {
    assertNoWindowConflict(profile, toKind, candidate, toKind === fromKind ? index : -1);
  }

  profile[fromConfig.property] = profile[fromConfig.property].filter((_, itemIndex) => itemIndex !== index);
  profile[toConfig.property] = [...profile[toConfig.property], candidate];
  return markUpdated(profile);
}

export function deleteAvailabilityWindow(profileInput, ref) {
  const profile = validateProfile(profileInput);
  const kind = normalizeAvailabilityKind(ref.kind);
  const config = availabilityKinds[kind];
  const index = Number(ref.index);

  if (!Number.isInteger(index) || index < 0 || !profile[config.property][index]) {
    throw new Error(`No ${kind} availability window found at index ${ref.index}`);
  }

  profile[config.property] = profile[config.property].filter((_, itemIndex) => itemIndex !== index);
  return markUpdated(profile);
}
