import fs from "node:fs/promises";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  addAvailability,
  addAvailabilityBatch,
  addBaseAvailability,
  addBaseAvailabilityBatch,
  blockAvailability,
  blockAvailabilityBatch,
  createProfile,
  deleteAvailabilityWindow,
  getAvailabilityWindow,
  listAvailabilityWindows,
  replaceBaseAvailabilityForDays,
  updateAvailabilityWindow,
  validateProfile
} from "./profile.js";
import {
  availabilityHome,
  exportMyProfile,
  importTeammate,
  listProfiles,
  listTeammates,
  readJson,
  readMyProfile,
  readState,
  removeTeammate,
  writeMyProfile
} from "./storage.js";
import { findOverlapWindows } from "./availability.js";
import { parseOneTimeAvailabilityExpression, parseScheduleExpression } from "./schedule-expression.js";
import { addDays, normalizeDate, todayString, validateTimeZone } from "./time.js";

const mainRows = [
  { id: "my", label: "My availability" },
  { id: "teammates", label: "Teammates" },
  { id: "overlap", label: "Find shared windows" },
  { id: "import", label: "Import teammate JSON" },
  { id: "export", label: "Export my JSON" },
  { id: "settings", label: "Settings" },
  { id: "help", label: "Help" },
  { id: "quit", label: "Quit" }
];

const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const timezoneSearchHints = {
  florida: ["America/New_York", "America/Chicago"],
  eastern: ["America/New_York"],
  "new york": ["America/New_York"],
  california: ["America/Los_Angeles"],
  pacific: ["America/Los_Angeles"],
  "los angeles": ["America/Los_Angeles"],
  london: ["Europe/London"],
  india: ["Asia/Kolkata"],
  kolkata: ["Asia/Kolkata"],
  chicago: ["America/Chicago"],
  central: ["America/Chicago"],
  denver: ["America/Denver"],
  mountain: ["America/Denver"]
};

class NavigationSignal extends Error {
  constructor(action) {
    super(action);
    this.action = action;
  }
}

async function handleNestedNavigation(key) {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    throw new NavigationSignal("quit");
  }
  if (key.name === "m") {
    throw new NavigationSignal("main");
  }
  if (key.name === "?") {
    await helpScreen();
    return true;
  }
  return false;
}

function clear() {
  stdout.write("\x1b[2J\x1b[H");
}

function bright(value) {
  return `\x1b[1m${value}\x1b[22m`;
}

function faint(value) {
  return `\x1b[2m${value}\x1b[22m`;
}

function inverse(value) {
  return `\x1b[7m${value}\x1b[27m`;
}

function setRawMode(enabled) {
  if (stdin.isTTY) {
    stdin.setRawMode(enabled);
  }
}

function supportedTimeZones() {
  if (typeof Intl.supportedValuesOf === "function") {
    return [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC"])].sort();
  }

  return [
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "Europe/Paris",
    "Asia/Kolkata",
    "UTC"
  ];
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timezoneOffsetLabel(timeZone, date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset"
  });
  const part = formatter.formatToParts(date).find((item) => item.type === "timeZoneName");
  return part?.value || "GMT";
}

function localTimeLabel(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function ageDays(dateValue) {
  if (!dateValue) {
    return null;
  }
  const ageMs = Date.now() - new Date(dateValue).getTime();
  return Math.max(0, Math.floor(ageMs / 86400000));
}

function profileFreshness(item) {
  const profileAge = ageDays(item.profile.updatedAt);
  const importAge = ageDays(item.importedAt);
  const imported = importAge === null ? "Imported: unknown" : `Imported: ${importAge === 0 ? "today" : `${importAge} days ago`}`;
  const updated = profileAge === null
    ? "Profile updated by teammate: unknown"
    : `Profile updated by teammate: ${profileAge === 0 ? "today" : `${profileAge} days ago`}`;

  let status = "Status: current";
  if (profileAge === null) {
    status = "Status: unknown profile age";
  } else if (profileAge >= 14) {
    status = "Status: stale profile data";
  } else if (importAge !== null && importAge >= 14) {
    status = "Status: possibly stale local import";
  }

  return { imported, updated, status };
}

function formatDateChoice(date) {
  const [year, month, day] = date.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
  return `${label} (${date})`;
}

function isoMinute(date) {
  return date.toISOString().replace(/:00\.000Z$/, "Z");
}

function trimLine(value, width) {
  if (value.length <= width) {
    return value;
  }
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function footer() {
  return faint("Controls: ↑/↓ move • Enter select • Esc back • m main menu • q quit • ? help");
}

function selectedLine(isSelected, label) {
  return `${isSelected ? ">" : " "} ${isSelected ? inverse(` ${label} `) : label}`;
}

function statusLines(profile, state) {
  if (!profile) {
    return [
      "Profile Status",
      "  Missing local profile.",
      "  Create your profile before adding availability, exporting, or finding shared windows."
    ];
  }

  const hasWindows = profile.baseAvailability.length + profile.addedAvailability.length > 0;
  const changedSinceExport = !state.lastExportedAt || (
    profile.updatedAt && new Date(profile.updatedAt) > new Date(state.lastExportedAt)
  );

  return [
    "Profile Status",
    `  OK Name set: ${profile.name}`,
    `  OK Timezone set: ${profile.timeZone}`,
    hasWindows ? "  OK Availability windows exist" : "  Missing availability windows",
    `${profile.role ? "  OK" : "  Optional"} Role ${profile.role ? `set: ${profile.role}` : "not set"}`,
    `${changedSinceExport ? "  Warning" : "  OK"} ${changedSinceExport ? "Local profile changed since last export" : "Export is current"}`,
    `  Profile is ${hasWindows ? "usable" : "not ready: add at least one availability window"}.`
  ];
}

function formatWindowRow(window) {
  const where = window.kind === "base" ? window.day : window.date;
  return `${window.number}. ${window.kindLabel.padEnd(18)} ${where.padEnd(10)} ${window.start} - ${window.end}`;
}

function availabilityRows(profile) {
  if (!profile) {
    return [];
  }

  return listAvailabilityWindows(profile).map((window) => ({
    type: "window",
    label: formatWindowRow(window),
    window
  }));
}

function formatAvailabilityByDay(profile) {
  if (!profile) {
    return ["No profile yet."];
  }

  const lines = [];
  const baseByDay = new Map(days.map((day) => [day, []]));
  for (const window of profile.baseAvailability) {
    baseByDay.get(window.day)?.push(window);
  }

  lines.push("Base Availability");
  for (const day of days) {
    const windows = baseByDay.get(day) || [];
    lines.push(`${day[0].toUpperCase()}${day.slice(1)}`);
    if (windows.length === 0) {
      lines.push("  No availability");
    } else {
      for (const window of windows) {
        lines.push(`  ${window.start} - ${window.end}`);
      }
    }
  }

  lines.push("");
  lines.push("Overrides");
  const added = profile.addedAvailability.map((window) => `  ${window.date}  ${window.start} - ${window.end} added availability`);
  const blocked = profile.blockedAvailability.map((window) => `  ${window.date}  ${window.start} - ${window.end} blocked`);
  if (added.length === 0 && blocked.length === 0) {
    lines.push("  No added availability or blocked time");
  } else {
    lines.push(...blocked, ...added);
  }

  return lines;
}

function joinWindows(windows) {
  if (!windows || windows.length === 0) {
    return "—";
  }
  return windows.map((window) => `${window.start}-${window.end}`).join(", ");
}

function weeklyAvailabilityLines(profile) {
  return [
    "Weekly Availability",
    ...days.map((day) => {
      const windows = profile.baseAvailability.filter((window) => window.day === day);
      return `${day[0].toUpperCase()}${day.slice(1).padEnd(11)} ${joinWindows(windows)}`;
    })
  ];
}

function recurringBlockLines(profile) {
  const lines = ["Recurring Blocks"];
  if (profile.blockedBaseAvailability.length === 0) {
    lines.push("—");
    return lines;
  }

  for (const day of days) {
    const windows = profile.blockedBaseAvailability.filter((window) => window.day === day);
    if (windows.length > 0) {
      lines.push(`${day[0].toUpperCase()}${day.slice(1).padEnd(11)} ${joinWindows(windows)}`);
    }
  }
  return lines;
}

function oneTimeOverrideLines(profile) {
  const lines = ["One-Time Overrides"];
  const entries = [
    ...profile.addedAvailability.map((window) => `${window.date}  added   ${window.start}-${window.end}`),
    ...profile.blockedAvailability.map((window) => `${window.date}  blocked ${window.start}-${window.end}`)
  ].sort();

  if (entries.length === 0) {
    lines.push("—");
    return lines;
  }

  return [...lines, ...entries];
}

function previewExpressionLines(title, expression, kindLabel) {
  const lines = [title];
  if (expression.days?.length) {
    for (const day of expression.days) {
      lines.push(`${day[0].toUpperCase()}${day.slice(1).padEnd(11)} ${joinWindows(expression.windows)}${kindLabel ? ` ${kindLabel}` : ""}`);
    }
  }
  if (expression.dates?.length) {
    for (const date of expression.dates) {
      lines.push(`${date}  ${joinWindows(expression.windows)}${kindLabel ? ` ${kindLabel}` : ""}`);
    }
  }
  return lines;
}

async function promptLine(question, { defaultValue = "" } = {}) {
  setRawMode(false);
  stdout.write("\n");
  const rl = readlinePromises.createInterface({ input: stdin, output: stdout });

  try {
    const answer = (await rl.question(question)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
    setRawMode(true);
  }
}

async function promptRequired(question, options = {}) {
  const answer = await promptLine(question, options);
  if (!answer) {
    throw new Error(`${question.replace(/[: ]+$/, "")} is required`);
  }
  return answer;
}

async function waitForKey() {
  return new Promise((resolve) => {
    const onData = () => {
      stdin.off("data", onData);
      resolve();
    };
    stdin.on("data", onData);
  });
}

async function waitForStartOrQuit() {
  while (true) {
    const key = await readKey();
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      throw new NavigationSignal("quit");
    }
    if (key.name === "?") {
      await helpScreen();
      continue;
    }
    return;
  }
}

async function showTransientMessage(title, lines) {
  clear();
  stdout.write(`${bright(title)}

${lines.join("\n")}

${footer()}
`);
  await waitForKey();
}

function renderScreen({ title, subtitle, body = [], rows = [], selected = 0, message = "" }) {
  const width = stdout.columns || 100;
  const lines = [bright(title)];
  if (subtitle) {
    lines.push(faint(subtitle));
  }
  lines.push("");
  lines.push(...body.map((line) => trimLine(line, width)));

  if (rows.length > 0) {
    if (body.length > 0) {
      lines.push("");
    }
    rows.forEach((row, index) => lines.push(selectedLine(index === selected, trimLine(row.label, width - 4))));
  }

  lines.push("");
  lines.push(footer());
  if (message) {
    lines.push("");
    lines.push(message);
  }

  clear();
  stdout.write(`${lines.join("\n")}\n`);
}

async function confirmScreen(title, body, confirmLabel = "Confirm") {
  let selected = 1;
  const rows = [
    { label: confirmLabel, value: true },
    { label: "Cancel", value: false }
  ];

  while (true) {
    renderScreen({ title, body, rows, selected });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "left" || key.name === "up" || key.name === "k") {
      selected = (selected - 1 + rows.length) % rows.length;
    } else if (key.name === "right" || key.name === "down" || key.name === "j") {
      selected = (selected + 1) % rows.length;
    } else if (key.name === "return") {
      return rows[selected].value;
    } else if (key.name === "escape" || key.name === "q") {
      return false;
    }
  }
}

function readKey() {
  return new Promise((resolve) => {
    stdin.once("keypress", (_chunk, keypress) => resolve(keypress));
  });
}

async function chooseTimezone() {
  const zones = supportedTimeZones();
  const detected = localTimeZone();
  let query = "";
  let selected = 0;

  while (true) {
    const lower = query.toLowerCase();
    const hintZones = timezoneSearchHints[lower] || [];
    const matches = zones.filter((zone) => zone.toLowerCase().includes(lower));
    const resultSet = [...new Set([...hintZones, ...matches])].filter((zone) => zones.includes(zone));
    const visible = (query ? resultSet : zones).slice(0, 20);
    const rows = [
      { label: `Use detected local timezone: ${detected}`, zone: detected },
      ...visible.map((zone) => ({ label: zone, zone })),
      { label: "Enter timezone manually", manual: true },
      { label: "Search again", search: true }
    ];
    selected = Math.min(selected, rows.length - 1);

    const body = [
      "Use IANA timezone names, not abbreviations.",
      "Good: America/Los_Angeles, America/New_York, Europe/London, Asia/Kolkata",
      "Avoid: PST, EST, CST",
      "",
      "Timezone names are organized as Region/City.",
      "Search examples: los angeles, california, pacific, florida, eastern, london, india",
      query ? `Search results for "${query}"` : "Browse supported timezones or search."
    ];

    if (lower === "florida") {
      body.push("Florida note: most of Florida uses America/New_York. Parts of the Panhandle use America/Chicago.");
    }

    renderScreen({ title: "Choose timezone", body, rows, selected });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;

    if (key.name === "up" || key.name === "k") {
      selected = (selected - 1 + rows.length) % rows.length;
    } else if (key.name === "down" || key.name === "j") {
      selected = (selected + 1) % rows.length;
    } else if (key.name === "escape") {
      return null;
    } else if (key.name === "return") {
      const row = rows[selected];
      if (row.search) {
        query = await promptLine("Search timezones by city, region, or phrase: ");
        selected = 0;
      } else if (row.manual) {
        const manual = await promptRequired("Enter timezone manually, example America/Los_Angeles: ");
        validateTimeZone(manual);
        if (await confirmTimezone(manual)) {
          return manual;
        }
      } else if (await confirmTimezone(row.zone)) {
        return row.zone;
      }
    } else if (key.name === "s" || key.name === "/") {
      query = await promptLine("Search timezones by city, region, or phrase: ");
      selected = 0;
    }
  }
}

async function confirmTimezone(timeZone) {
  return confirmScreen("Confirm timezone", [
    `Selected timezone: ${timeZone}`,
    `For the current week, this resolves to: ${timezoneOffsetLabel(timeZone)}`,
    `Current local time there: ${localTimeLabel(timeZone)}`,
    "",
    "Use this timezone?"
  ], "Use timezone");
}

async function chooseDateToCheck() {
  let selected = 0;
  const today = todayString();
  const tomorrow = todayString(1);
  const rows = [
    { label: `Today - ${formatDateChoice(today)}`, date: today },
    { label: `Tomorrow - ${formatDateChoice(tomorrow)}`, date: tomorrow },
    { label: "This week - choose a day", range: { start: today, days: 7, title: "Choose a day this week" } },
    { label: "Next 7 days - choose a day", range: { start: tomorrow, days: 7, title: "Choose a day in the next 7 days" } },
    { label: "Enter date manually", manual: true }
  ];

  while (true) {
    renderScreen({
      title: "Date to check",
      body: [
        "The MVP checks one day at a time.",
        "Choose a day below, or enter a date manually."
      ],
      rows,
      selected
    });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
    else if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
    else if (key.name === "escape") return null;
    else if (key.name === "return") {
      const row = rows[selected];
      if (row.date) return row.date;
      if (row.manual) return normalizeDate(await promptRequired("Date to check. Use today, tomorrow, or YYYY-MM-DD: "));
      if (row.range) return chooseDateFromRange(row.range.title, row.range.start, row.range.days);
    }
  }
}

async function chooseDateFromRange(title, startDate, days) {
  let selected = 0;
  const rows = Array.from({ length: days }, (_, index) => {
    const date = addDays(startDate, index);
    return { label: formatDateChoice(date), date };
  });

  while (true) {
    renderScreen({
      title,
      body: ["Select one date. Multi-day overlap search is not implemented yet."],
      rows,
      selected
    });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
    else if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
    else if (key.name === "escape") return null;
    else if (key.name === "return") return rows[selected].date;
  }
}

async function chooseProfilesForOverlap(profiles) {
  let selected = 0;
  const checked = new Set(profiles.map((profile) => profile.id));
  const rowsForRender = () => profiles.map((profile) => ({
    label: `${checked.has(profile.id) ? "[x]" : "[ ]"} ${profile.name.padEnd(22)} ${profile.timeZone}`,
    profile
  }));

  while (true) {
    const rows = rowsForRender();
    renderScreen({
      title: "People to include",
      body: [
        "Choose who must be available in the shared window.",
        "Controls here: Space toggle • Enter continue • a select all • n select none • Esc back"
      ],
      rows,
      selected
    });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
    else if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
    else if (key.name === "a") profiles.forEach((profile) => checked.add(profile.id));
    else if (key.name === "n") checked.clear();
    else if (key.name === "space") {
      const id = rows[selected].profile.id;
      if (checked.has(id)) checked.delete(id);
      else checked.add(id);
    } else if (key.name === "escape") {
      return null;
    } else if (key.name === "return") {
      const selectedProfiles = profiles.filter((profile) => checked.has(profile.id));
      if (selectedProfiles.length === 0) {
        await confirmScreen("No people selected", [
          "Select at least one profile before finding shared windows."
        ], "Back");
      } else {
        return selectedProfiles;
      }
    }
  }
}

async function chooseProfileTimezone(existing) {
  if (!existing) {
    return chooseTimezone();
  }

  let selected = 0;
  const rows = [
    { label: `Keep current timezone: ${existing.timeZone}`, keep: true },
    { label: "Change timezone", change: true }
  ];

  while (true) {
    renderScreen({
      title: "Profile timezone",
      body: [
        `Current timezone: ${existing.timeZone}`,
        `Current local time there: ${localTimeLabel(existing.timeZone)}`,
        "",
        "Keep the current timezone unless you are correcting a mistake."
      ],
      rows,
      selected
    });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
    else if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
    else if (key.name === "escape") return existing.timeZone;
    else if (key.name === "return") {
      if (rows[selected].keep) return existing.timeZone;
      return chooseTimezone();
    }
  }
}

async function profileForm(existing = null) {
  const name = await promptRequired(
    `Name identifies your local profile. Example: William\nName${existing ? ` [${existing.name}]` : ""}: `,
    { defaultValue: existing?.name || "" }
  );
  const role = await promptLine(
    `Role is optional. It is a label for grouping teammates later.\nExamples: Founder, Frontend Developer, Backend, Design, Contractor\nRole${existing?.role ? ` [${existing.role}]` : " [optional]"}: `,
    { defaultValue: existing?.role || "" }
  );
  const timezone = await chooseProfileTimezone(existing);
  if (!timezone) {
    throw new Error("Timezone selection cancelled");
  }
  const tagsText = await promptLine(
    `Tags are optional comma-separated labels. Examples: frontend, leadership, contractor\nTags${existing?.tags?.length ? ` [${existing.tags.join(", ")}]` : " [optional]"}: `,
    { defaultValue: existing?.tags?.join(", ") || "" }
  );

  const next = createProfile({
    name,
    role,
    timeZone: timezone,
    tags: tagsText ? tagsText.split(",").map((tag) => tag.trim()).filter(Boolean) : []
  });

  if (existing) {
    return {
      ...next,
      id: existing.id,
      createdAt: existing.createdAt,
      baseAvailability: existing.baseAvailability,
      addedAvailability: existing.addedAvailability,
      blockedAvailability: existing.blockedAvailability
    };
  }

  return next;
}

async function windowForm(kind, existing = {}) {
  const currentType = kind || existing.kind || "base";
  const typeAnswer = await promptLine(
    `Window type controls how this affects availability.\nbase = normal weekly availability\nblocked-base = recurring blocked time\nadded = temporary extra time\nblocked = one-time unavailable time\nType [${currentType}]: `,
    { defaultValue: currentType }
  );
  const type = typeAnswer.toLowerCase();
  const start = await promptRequired(
    `Start time for this window. Examples: 9am, 13:30, 6 pm\nStart time${existing.start ? ` [${existing.start}]` : ""}: `,
    { defaultValue: existing.start || "" }
  );
  const end = await promptRequired(
    `End time for this window. It must be after the start time.\nWindows cannot cross midnight yet; split late-night time into two windows.\nEnd time${existing.end ? ` [${existing.end}]` : ""}: `,
    { defaultValue: existing.end || "" }
  );

  if (type === "base" || type === "blocked-base" || type === "recurring-block") {
    const day = await promptRequired(
      `Day for weekly base availability. Examples: monday, mon, friday, fri\nDay${existing.day ? ` [${existing.day}]` : ""}: `,
      { defaultValue: existing.day || "" }
    );
    return { kind: type === "recurring-block" ? "blocked-base" : type, day, start, end };
  }

  const date = normalizeDate(await promptRequired(
    `Date for temporary availability or blocked time. Examples: today, tomorrow, 2026-06-12\nDate${existing.date ? ` [${existing.date}]` : ""}: `,
    { defaultValue: existing.date || "" }
  ));
  return { kind: type, date, start, end };
}

async function previewWeeklyScheduleFlow(profile) {
  const expressionText = await promptRequired(
    "Describe your normal weekly availability.\nExamples:\nweekdays 8am to 9pm\nmonday through wednesday 10am to 3pm\nmonday, wednesday, friday 9am to 12pm\nmonday 8am to 12pm and 3pm to 8pm\nAvailability: "
  );
  const expression = parseScheduleExpression(expressionText);

  let selected = 0;
  const rows = [
    { label: "Replace existing availability on these days", action: "replace" },
    { label: "Add alongside existing availability", action: "add" },
    { label: "Cancel", action: "cancel" }
  ];

  while (true) {
    renderScreen({
      title: "Preview weekly availability",
      body: [
        `You entered: ${expressionText}`,
        "This will create:",
        ...previewExpressionLines("", expression).filter(Boolean)
      ],
      rows,
      selected
    });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
    else if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
    else if (key.name === "escape") return "Weekly availability cancelled.";
    else if (key.name === "return") {
      const action = rows[selected].action;
      if (action === "cancel") return "Weekly availability cancelled.";
      const next = action === "replace"
        ? replaceBaseAvailabilityForDays(profile, expression)
        : addBaseAvailabilityBatch(profile, expression);
      await writeMyProfile(next);
      return "Weekly availability saved. Export a new JSON file when ready to share.";
    }
  }
}

async function oneTimeAvailabilityFlow(profile) {
  const expressionText = await promptRequired(
    "Describe extra availability for a specific date.\nExamples:\ntoday 6pm to 8pm\ntomorrow 9am to 11am\n2026-06-12 6pm to 8pm\nAvailability: "
  );
  const expression = parseOneTimeAvailabilityExpression(expressionText);
  const confirmed = await confirmScreen("Preview one-time availability", [
    `You entered: ${expressionText}`,
    ...previewExpressionLines("This will add:", expression)
  ], "Save");

  if (!confirmed) {
    return "One-time availability cancelled.";
  }

  await writeMyProfile(addAvailabilityBatch(profile, expression));
  return "One-time availability saved. Export a new JSON file when ready to share.";
}

async function blockTimeFlow(profile) {
  const expressionText = await promptRequired(
    "Describe time to block.\nExamples:\ntoday 1pm to 3pm\nmonday 12pm to 3pm\nweekdays 12pm to 1pm\nmonday through friday 12pm to 1pm\nBlock: "
  );

  let expression;
  const recurring = !/^(today|tomorrow|\d{4}-\d{2}-\d{2})\b/.test(expressionText.trim().toLowerCase());

  if (recurring) {
    expression = parseScheduleExpression(expressionText);
  } else {
    expression = parseOneTimeAvailabilityExpression(expressionText);
  }

  const confirmed = await confirmScreen("Preview blocked time", [
    `You entered: ${expressionText}`,
    ...previewExpressionLines(recurring ? "This will block every week:" : "This will block:", expression)
  ], recurring ? "Save recurring block" : "Save");

  if (!confirmed) {
    return "Blocked time cancelled.";
  }

  await writeMyProfile(blockAvailabilityBatch(profile, expression));
  return recurring
    ? "Recurring blocked time saved. Export a new JSON file when ready to share."
    : "Blocked time saved. Export a new JSON file when ready to share.";
}

async function onboardingWizard() {
  while (true) {
    try {
      clear();
      stdout.write(`${bright("Welcome to Better Availability")}

This tool helps distributed teams share availability using local JSON files.
No accounts. No server. No calendar access.

First run setup:
  Step 1: Your name
  Step 2: Your optional role
  Step 3: Your timezone
  Step 4: Your normal availability
  Step 5: Export your JSON when ready

Press any key to start setup.
`);
      await waitForStartOrQuit();
      const profile = await profileForm();
      await writeMyProfile(profile);

      const addFirstWindow = await confirmScreen("Add normal availability?", [
        "Your profile exists. Add your first normal weekly availability window now?",
        "You can add, edit, or delete windows later from My availability."
      ], "Add window");

      if (addFirstWindow) {
        await writeMyProfile(profile);
        await previewWeeklyScheduleFlow(profile);
      }
      return;
    } catch (error) {
      if (error instanceof NavigationSignal) {
        throw error;
      }
      await showTransientMessage("Setup issue", [
        error.message,
        "",
        "The setup flow stayed inside the terminal app. Press any key to try again."
      ]);
    }
  }
}

function mainBody(myProfile, state, teammates) {
  const lines = [
    `Local team directory: ${availabilityHome()}`,
    "",
    ...statusLines(myProfile, state),
    "",
    `Imported teammates: ${teammates.length}`
  ];

  if (myProfile) {
    lines.push(`Timezone now: ${myProfile.timeZone} (${timezoneOffsetLabel(myProfile.timeZone)})`);
  }

  return lines;
}

function myAvailabilityBody(profile, state) {
  if (!profile) {
    return ["No local profile yet. Create your profile first."];
  }

  const changedSinceExport = !state.lastExportedAt || (
    profile.updatedAt && new Date(profile.updatedAt) > new Date(state.lastExportedAt)
  );

  return [
    "My Availability",
    `${profile.name}`,
    `${profile.timeZone} · ${timezoneOffsetLabel(profile.timeZone)}`,
    `Unexported changes: ${changedSinceExport ? "yes" : "no"}`,
    "",
    ...weeklyAvailabilityLines(profile),
    "",
    ...recurringBlockLines(profile),
    "",
    ...oneTimeOverrideLines(profile),
    "",
    "What do you want to do?"
  ];
}

function myAvailabilityRows(profile) {
  return [
    { type: "set-weekly", label: "Set weekly availability" },
    { type: "add-one-time", label: "Add one-time availability" },
    { type: "block", label: "Block time" },
    { type: "edit-delete", label: "Edit/delete existing windows" },
    { type: "export", label: "Export JSON" },
    { type: "settings", label: "Profile settings" },
    { type: "back", label: "Back" }
  ];
}

function editDeleteRows(profile) {
  return [
    ...availabilityRows(profile),
    { type: "back", label: "Back" }
  ];
}

function teammateRows(teammates) {
  return [
    ...teammates.map((item) => {
      const freshness = profileFreshness(item);
      return {
        type: "teammate",
        label: `${item.profile.name.padEnd(24)} ${item.profile.timeZone}  ${freshness.status.replace("Status: ", "")}`,
        teammate: item
      };
    }),
    { type: "import", label: "Import teammate JSON" },
    { type: "back", label: "Back" }
  ];
}

function teammateDetailBody(item) {
  const freshness = profileFreshness(item);
  return [
    "Teammate profile",
    `Name: ${item.profile.name}`,
    `Role: ${item.profile.role || "not set"}`,
    `Timezone: ${item.profile.timeZone}`,
    freshness.imported,
    freshness.updated,
    freshness.status,
    "",
    ...formatAvailabilityByDay(item.profile)
  ];
}

function noResultsGuidance(names, date, durationMinutes) {
  return [
    `No shared windows found for: ${names.join(", ") || "selected people"}`,
    `Date: ${date}`,
    `Duration: ${durationMinutes} minutes`,
    "",
    "Try:",
    "- reducing duration",
    "- removing one teammate",
    "- checking stale profiles",
    "- viewing each person's availability",
    "- adding or unblocking availability"
  ];
}

async function findSharedWindowsFlow() {
  const date = await chooseDateToCheck();
  if (!date) {
    return "Overlap query cancelled.";
  }
  const durationText = await promptLine("Minimum duration in minutes [30]: ", { defaultValue: "30" });
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    return "No profiles found. Create your profile or import teammate JSON first.";
  }
  const durationMinutes = Number(durationText || 30);
  const selectedProfiles = await chooseProfilesForOverlap(profiles);
  if (!selectedProfiles) {
    return "Overlap query cancelled.";
  }
  const windows = findOverlapWindows(selectedProfiles, { date, durationMinutes });
  const myProfile = await readMyProfile().catch(() => null);

  clear();
  if (windows.length === 0) {
    stdout.write(`${bright("No shared windows found")}\n\n${noResultsGuidance(
      selectedProfiles.map((profile) => profile.name),
      date,
      durationMinutes
    ).join("\n")}\n\n${footer()}\n`);
    await waitForKey();
    return;
  }

  stdout.write(`${bright(`Shared windows for ${date}`)}\n\n`);
  windows.forEach((window, index) => {
    const mine = myProfile ? window.localTimes.find((local) => local.id === myProfile.id) : null;
    const others = window.localTimes.filter((local) => !mine || local.id !== mine.id);

    stdout.write(`Shared Window #${index + 1}\n`);
    stdout.write(`Duration: ${window.durationMinutes} minutes\n`);
    stdout.write(`Reference: ${isoMinute(window.start)} - ${isoMinute(window.end)}\n`);
    if (mine) {
      stdout.write("You:\n");
      stdout.write(`  ${mine.name.padEnd(18)} ${mine.start} - ${mine.end} ${mine.timeZone}\n`);
    }
    if (others.length > 0) {
      stdout.write(mine ? "Others:\n" : "Selected people:\n");
      for (const local of others) {
        stdout.write(`  ${local.name.padEnd(18)} ${local.start} - ${local.end} ${local.timeZone}\n`);
      }
    }
    stdout.write("Why this works:\n");
    stdout.write("  All selected profiles have effective availability during this window.\n\n");
  });
  stdout.write(`${footer()}\n`);
  await waitForKey();
}

async function importFlow() {
  const source = await promptRequired("Path to teammate JSON file. This imports a local copy only: ");
  const incoming = validateProfile(await readJson(source));
  const teammates = await listTeammates();
  const existing = teammates.find((item) => item.profile.id === incoming.id);
  let mode = "replace";

  if (existing) {
    let selected = 0;
    const rows = [
      { label: "Replace existing", mode: "replace" },
      { label: "Keep both", mode: "keep-both" },
      { label: "Cancel", mode: "cancel" }
    ];
    while (true) {
      renderScreen({
        title: "Import conflict",
        body: [
          `${incoming.name} already exists.`,
          `Existing profile updated: ${existing.profile.updatedAt || "unknown"}`,
          `Imported profile updated: ${incoming.updatedAt || "unknown"}`,
          "",
          "Choose what to do."
        ],
        rows,
        selected
      });
      const key = await readKey();
      if (await handleNestedNavigation(key)) continue;
      if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
      if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
      if (key.name === "escape") return "Import cancelled.";
      if (key.name === "return") {
        mode = rows[selected].mode;
        break;
      }
    }
  }

  if (mode === "cancel") {
    return "Import cancelled.";
  }

  const result = await importTeammate(source, { onConflict: mode });
  return result.imported ? `Imported ${result.profile.name}.` : "Import cancelled.";
}

async function exportFlow() {
  const target = await promptRequired("Export path for your JSON file. Example: ./william.availability.json: ");
  const { profile } = await exportMyProfile(target);
  return `Exported ${profile.name}. Share that JSON with your team.`;
}

async function editWindowFlow(profile, window) {
  const edited = await windowForm(window.kind, window);
  await writeMyProfile(updateAvailabilityWindow(profile, { kind: window.kind, index: window.index }, edited));
  return "Window edited. Your local profile has changed. Export a new JSON file when ready to share.";
}

async function deleteWindowFlow(profile, window) {
  const where = window.kind === "base" ? window.day : window.date;
  const confirmed = await confirmScreen("Delete availability window?", [
    `Delete this ${window.kindLabel.toLowerCase()} window?`,
    `${where} ${window.start} - ${window.end}`,
    "",
    "This only changes your local profile until you export and share a new JSON."
  ], "Delete");

  if (!confirmed) {
    return "Delete cancelled.";
  }

  await writeMyProfile(deleteAvailabilityWindow(profile, { kind: window.kind, index: window.index }));
  return "Window deleted. Your local profile has changed. Export a new JSON file when ready to share.";
}

async function windowActionFlow(profile, window) {
  let selected = 0;
  const rows = [
    { label: "Edit selected window", id: "edit" },
    { label: "Delete selected window", id: "delete" },
    { label: "Back", id: "back" }
  ];

  while (true) {
    const where = window.kind === "base" ? window.day : window.date;
    renderScreen({
      title: "Selected availability window",
      body: [
        `${window.kindLabel}`,
        `${where} ${window.start} - ${window.end}`,
        "",
        "Choose what to do."
      ],
      rows,
      selected
    });
    const key = await readKey();
    if (await handleNestedNavigation(key)) continue;
    if (key.name === "up" || key.name === "k") selected = (selected - 1 + rows.length) % rows.length;
    if (key.name === "down" || key.name === "j") selected = (selected + 1) % rows.length;
    if (key.name === "escape") return "";
    if (key.name === "return") {
      if (rows[selected].id === "edit") return editWindowFlow(profile, window);
      if (rows[selected].id === "delete") return deleteWindowFlow(profile, window);
      return "";
    }
  }
}

async function helpScreen() {
  clear();
  stdout.write(`${bright("Help")}

What this tool does:
  Better Availability builds a local team availability map from portable JSON profiles.
  No accounts. No server. No calendar access.

Main ideas:
  My availability: your local profile and your windows.
  Teammates: imported teammate JSON profiles.
  Find shared windows: overlap across selected effective availability.
  Base availability: normal weekly working windows.
  Recurring blocked time: weekly unavailable windows such as weekday lunch.
  Added availability: temporary extra time on a date.
  Blocked time: temporary unavailable time on a date.

Sharing:
  Export my JSON after local changes.
  Send that JSON to teammates however you already communicate.
  Import teammate JSON files they send you.

Input formats:
  Timezone: Region/City, such as America/Los_Angeles.
  Time: 9am, 1:30pm, 13:30, or 09:00.
  Date: today, tomorrow, or 2026-06-12.
  Day: monday or mon.
  Weekly schedule: weekdays 8am to 9pm.
  Split schedule: monday 8am to 12pm and 3pm to 8pm.
  Recurring block: weekdays 12pm to 1pm.

${footer()}
`);
  await waitForKey();
}

async function settingsFlow() {
  const existing = await readMyProfile().catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const profile = await profileForm(existing);
  await writeMyProfile(profile);
  return "Profile settings saved. Export a new JSON file when ready to share.";
}

async function runApp() {
  let screen = "main";
  let selected = 0;
  let message = "";
  let teammateDetail = null;

  try {
    await readMyProfile();
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        await onboardingWizard();
      } catch (setupError) {
        if (setupError instanceof NavigationSignal && setupError.action === "quit") {
          return;
        }
        throw setupError;
      }
    } else {
      throw error;
    }
  }

  while (true) {
    const myProfile = await readMyProfile().catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const state = await readState();
    const teammates = await listTeammates();
    let rows = [];
    let title = "Better Availability";
    let body = [];

    if (screen === "main") {
      rows = mainRows;
      body = mainBody(myProfile, state, teammates);
    } else if (screen === "my") {
      title = "My availability";
      body = myAvailabilityBody(myProfile, state);
      rows = myAvailabilityRows(myProfile);
    } else if (screen === "edit-delete") {
      title = "Edit/delete existing windows";
      body = [
        "Select an existing window to edit or delete it.",
        "Recurring blocked time appears here as its own kind."
      ];
      rows = editDeleteRows(myProfile);
    } else if (screen === "teammates") {
      title = "Teammates";
      body = [
        "Imported teammate JSON profiles live only in your local team directory.",
        "Select a teammate to view availability or remove them safely.",
        "",
        teammates.length === 0 ? "No teammates imported yet." : "Imported Teammates"
      ];
      rows = teammateRows(teammates);
    } else if (screen === "teammate-detail" && teammateDetail) {
      title = `Teammate: ${teammateDetail.profile.name}`;
      body = teammateDetailBody(teammateDetail);
      rows = [
        { id: "remove", label: `Remove ${teammateDetail.profile.name}` },
        { id: "back", label: "Back" }
      ];
    }

    selected = Math.min(selected, Math.max(0, rows.length - 1));
    renderScreen({ title, body, rows, selected, message });
    message = "";
    const key = await readKey();

    if (key.name === "q" || (key.ctrl && key.name === "c")) break;
    if (key.name === "?") {
      await helpScreen();
      continue;
    }
    if (key.name === "m") {
      screen = "main";
      selected = 0;
      continue;
    }
    if (key.name === "escape") {
      if (screen === "main") break;
      screen = "main";
      selected = 0;
      continue;
    }
    if (key.name === "up" || key.name === "k") {
      selected = (selected - 1 + rows.length) % rows.length;
      continue;
    }
    if (key.name === "down" || key.name === "j") {
      selected = (selected + 1) % rows.length;
      continue;
    }
    if (key.name !== "return") {
      continue;
    }

    const row = rows[selected];
    try {
      if (screen === "main") {
        if (row.id === "my") screen = "my";
        else if (row.id === "teammates") screen = "teammates";
        else if (row.id === "overlap") message = await findSharedWindowsFlow() || "";
        else if (row.id === "import") message = await importFlow();
        else if (row.id === "export") message = await exportFlow();
        else if (row.id === "settings") message = await settingsFlow();
        else if (row.id === "help") await helpScreen();
        else if (row.id === "quit") break;
        selected = 0;
      } else if (screen === "my") {
        if (row.type === "set-weekly") {
          message = await previewWeeklyScheduleFlow(await readMyProfile());
        } else if (row.type === "add-one-time") {
          message = await oneTimeAvailabilityFlow(await readMyProfile());
        } else if (row.type === "block") {
          message = await blockTimeFlow(await readMyProfile());
        } else if (row.type === "edit-delete") {
          screen = "edit-delete";
          selected = 0;
        } else if (row.type === "export") {
          message = await exportFlow();
        } else if (row.type === "settings") {
          message = await settingsFlow();
        } else if (row.type === "back") {
          screen = "main";
          selected = 0;
        }
      } else if (screen === "edit-delete") {
        if (row.type === "window") {
          const freshProfile = await readMyProfile();
          const freshWindow = getAvailabilityWindow(freshProfile, row.window.kind, row.window.index);
          message = await windowActionFlow(freshProfile, freshWindow);
        } else {
          screen = "my";
          selected = 0;
        }
      } else if (screen === "teammates") {
        if (row.type === "teammate") {
          teammateDetail = row.teammate;
          screen = "teammate-detail";
          selected = 0;
        } else if (row.type === "import") {
          message = await importFlow();
        } else if (row.type === "back") {
          screen = "main";
          selected = 0;
        }
      } else if (screen === "teammate-detail") {
        if (row.id === "remove") {
          const confirmed = await confirmScreen("Remove teammate?", [
            `Remove ${teammateDetail.profile.name} from your local team directory?`,
            "This does not affect their JSON file or anyone else's app."
          ], "Remove");
          if (confirmed) {
            await removeTeammate(teammateDetail.profile.id);
            message = `Removed ${teammateDetail.profile.name}.`;
            teammateDetail = null;
            screen = "teammates";
            selected = 0;
          }
        } else {
          screen = "teammates";
          selected = 0;
        }
      }
    } catch (error) {
      if (error instanceof NavigationSignal) {
        if (error.action === "quit") {
          break;
        }
        if (error.action === "main") {
          screen = "main";
          selected = 0;
          message = "";
          continue;
        }
      }
      message = `Error: ${error.message}`;
    }
  }
}

export async function launchTui() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("The terminal app requires an interactive terminal. Use `better-availability help` for command mode.");
  }

  readline.emitKeypressEvents(stdin);
  setRawMode(true);
  stdin.resume();

  try {
    await runApp();
  } finally {
    setRawMode(false);
    clear();
    stdin.pause();
  }
}
