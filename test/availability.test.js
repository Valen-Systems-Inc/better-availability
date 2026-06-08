import assert from "node:assert/strict";
import test from "node:test";
import { findOverlapWindows, effectiveLocalWindows } from "../src/availability.js";
import { addAvailability, blockAvailability, createProfile } from "../src/profile.js";

function profile(overrides) {
  return {
    schemaVersion: 1,
    id: overrides.id,
    name: overrides.name,
    role: "",
    tags: overrides.tags || [],
    timeZone: overrides.timeZone,
    baseAvailability: overrides.baseAvailability || [],
    addedAvailability: overrides.addedAvailability || [],
    blockedAvailability: overrides.blockedAvailability || []
  };
}

test("finds overlap across Los Angeles and Florida time zones", () => {
  const william = profile({
    id: "william",
    name: "William",
    timeZone: "America/Los_Angeles",
    baseAvailability: [{ day: "monday", start: "10:00", end: "14:00" }]
  });
  const floridaDeveloper = profile({
    id: "florida-developer",
    name: "Florida Developer",
    timeZone: "America/New_York",
    baseAvailability: [{ day: "monday", start: "13:00", end: "17:00" }]
  });

  const windows = findOverlapWindows([william, floridaDeveloper], {
    date: "2026-06-08",
    durationMinutes: 30
  });

  assert.equal(windows.length, 1);
  assert.equal(windows[0].durationMinutes, 240);
  assert.equal(windows[0].start.toISOString(), "2026-06-08T17:00:00.000Z");
  assert.equal(windows[0].end.toISOString(), "2026-06-08T21:00:00.000Z");
  assert.match(windows[0].localTimes[0].start, /10:00/);
  assert.match(windows[0].localTimes[1].start, /13:00/);
});

test("applies added availability and blocked availability before overlap", () => {
  let william = profile({
    id: "william",
    name: "William",
    timeZone: "America/Los_Angeles",
    baseAvailability: [{ day: "friday", start: "11:00", end: "15:00" }]
  });
  william = blockAvailability(william, { date: "2026-06-12", start: "13:00", end: "15:00" });
  william = addAvailability(william, { date: "2026-06-12", start: "18:00", end: "20:00" });

  const effective = effectiveLocalWindows(william, "2026-06-12");

  assert.deepEqual(
    effective.map((window) => [window.start, window.end]),
    [
      [660, 780],
      [1080, 1200]
    ]
  );
});

test("filters overlaps that are shorter than desired duration", () => {
  const a = profile({
    id: "a",
    name: "A",
    timeZone: "Europe/London",
    baseAvailability: [{ day: "tuesday", start: "09:00", end: "09:45" }]
  });
  const b = profile({
    id: "b",
    name: "B",
    timeZone: "Europe/London",
    baseAvailability: [{ day: "tuesday", start: "09:15", end: "10:00" }]
  });

  assert.equal(findOverlapWindows([a, b], { date: "2026-06-09", durationMinutes: 30 }).length, 1);
  assert.equal(findOverlapWindows([a, b], { date: "2026-06-09", durationMinutes: 60 }).length, 0);
});

test("creates valid local-first profiles with real IANA time zones", () => {
  const created = createProfile({
    name: "Frontend Dev",
    timeZone: "Europe/London",
    role: "Engineer",
    tags: ["frontend"]
  });

  assert.equal(created.id, "frontend-dev");
  assert.equal(created.timeZone, "Europe/London");
  assert.throws(() => createProfile({ name: "Bad TZ", timeZone: "PST" }), /Invalid IANA time zone/);
});
