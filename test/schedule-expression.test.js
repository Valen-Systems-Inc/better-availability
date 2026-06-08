import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDayExpression,
  parseOneTimeAvailabilityExpression,
  parseScheduleExpression,
  parseTimeWindowExpression
} from "../src/schedule-expression.js";

test("parses weekday-style schedule expressions", () => {
  assert.deepEqual(parseScheduleExpression("weekdays 8am to 9pm"), {
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    windows: [{ start: "08:00", end: "21:00" }]
  });

  assert.deepEqual(parseScheduleExpression("monday through friday 8am to 9pm"), {
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    windows: [{ start: "08:00", end: "21:00" }]
  });

  assert.deepEqual(parseScheduleExpression("monday-friday 8am to 9pm"), {
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    windows: [{ start: "08:00", end: "21:00" }]
  });

  assert.deepEqual(parseScheduleExpression("mon-fri 8am to 9pm"), {
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    windows: [{ start: "08:00", end: "21:00" }]
  });
});

test("parses multi-day and multi-window schedule expressions", () => {
  assert.deepEqual(parseScheduleExpression("monday through wednesday 10am to 3pm"), {
    days: ["monday", "tuesday", "wednesday"],
    windows: [{ start: "10:00", end: "15:00" }]
  });

  assert.deepEqual(parseScheduleExpression("monday, wednesday, friday 9am to 12pm"), {
    days: ["monday", "wednesday", "friday"],
    windows: [{ start: "09:00", end: "12:00" }]
  });

  assert.deepEqual(parseScheduleExpression("tuesday and thursday 1pm to 5pm"), {
    days: ["tuesday", "thursday"],
    windows: [{ start: "13:00", end: "17:00" }]
  });

  assert.deepEqual(parseScheduleExpression("every day 8am to 10am"), {
    days: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
    windows: [{ start: "08:00", end: "10:00" }]
  });

  assert.deepEqual(parseScheduleExpression("weekends 12pm to 4pm"), {
    days: ["saturday", "sunday"],
    windows: [{ start: "12:00", end: "16:00" }]
  });

  assert.deepEqual(parseScheduleExpression("monday 8am to 12pm and 3pm to 8pm"), {
    days: ["monday"],
    windows: [
      { start: "08:00", end: "12:00" },
      { start: "15:00", end: "20:00" }
    ]
  });
});

test("parses day and time expressions directly", () => {
  assert.deepEqual(parseDayExpression("weekdays"), ["monday", "tuesday", "wednesday", "thursday", "friday"]);
  assert.deepEqual(parseDayExpression("monday and wednesday"), ["monday", "wednesday"]);
  assert.deepEqual(parseTimeWindowExpression("8am-12pm, 3pm-8pm"), [
    { start: "08:00", end: "12:00" },
    { start: "15:00", end: "20:00" }
  ]);
  assert.deepEqual(parseTimeWindowExpression("8-12"), [
    { start: "08:00", end: "12:00" }
  ]);
  assert.deepEqual(parseTimeWindowExpression("8 to 12"), [
    { start: "08:00", end: "12:00" }
  ]);
});

test("parses one-time availability expressions", () => {
  assert.deepEqual(
    parseOneTimeAvailabilityExpression("today 6pm to 8pm", new Date(2026, 5, 8, 10, 0, 0)),
    {
      dates: ["2026-06-08"],
      windows: [{ start: "18:00", end: "20:00" }]
    }
  );
});
