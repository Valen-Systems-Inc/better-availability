import fs from "node:fs/promises";
import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  addAvailability,
  addBaseAvailability,
  blockAvailability,
  createProfile
} from "./profile.js";
import {
  availabilityHome,
  importTeammate,
  listProfiles,
  readMyProfile,
  selectProfiles,
  writeMyProfile
} from "./storage.js";
import { findOverlapWindows } from "./availability.js";
import { validateTimeZone } from "./time.js";

const actions = [
  { id: "dashboard", label: "Team availability dashboard" },
  { id: "overlap", label: "Query overlap windows" },
  { id: "init", label: "Create or replace my profile" },
  { id: "base", label: "Add base availability" },
  { id: "add", label: "Add temporary availability" },
  { id: "block", label: "Block availability" },
  { id: "import", label: "Import teammate JSON" },
  { id: "export", label: "Export my JSON" },
  { id: "help", label: "Help" },
  { id: "quit", label: "Quit" }
];

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

function regionSummary(zones) {
  return [...new Set(zones.map((zone) => zone.split("/")[0]))].sort().join(", ");
}

function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function clear() {
  stdout.write("\x1b[2J\x1b[H");
}

function faint(value) {
  return `\x1b[2m${value}\x1b[22m`;
}

function bright(value) {
  return `\x1b[1m${value}\x1b[22m`;
}

function inverse(value) {
  return `\x1b[7m${value}\x1b[27m`;
}

function trimLine(value, width) {
  if (value.length <= width) {
    return value;
  }

  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function formatProfiles(profiles, width) {
  if (profiles.length === 0) {
    return ["No local profiles yet. Choose \"Create or replace my profile\" to start."];
  }

  return profiles.map((profile) => {
    const tags = profile.tags.length ? `  [${profile.tags.join(", ")}]` : "";
    const windowCount = profile.baseAvailability.length + profile.addedAvailability.length;
    const status = windowCount === 0 ? "no availability yet" : `${windowCount} window${windowCount === 1 ? "" : "s"}`;
    return trimLine(`${profile.id.padEnd(18)} ${profile.name.padEnd(22)} ${profile.timeZone}  ${status}${tags}`, width);
  });
}

function todayString(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

function normalizeDateAnswer(answer) {
  const value = answer.trim().toLowerCase();
  if (value === "today") {
    return todayString(0);
  }
  if (value === "tomorrow") {
    return todayString(1);
  }
  return answer;
}

function renderHome({ selected, message, profiles }) {
  const width = stdout.columns || 88;
  const lines = [];

  lines.push(bright("Better Availability"));
  lines.push(faint(`Local team directory: ${availabilityHome()}`));
  lines.push("");
  lines.push(bright("Profiles"));
  lines.push(...formatProfiles(profiles, width).map((line) => `  ${line}`));
  lines.push("");
  lines.push(bright("Actions"));

  actions.forEach((action, index) => {
    const marker = index === selected ? ">" : " ";
    const label = index === selected ? inverse(` ${action.label} `) : ` ${action.label}`;
    lines.push(`${marker}${label}`);
  });

  lines.push("");
  lines.push(faint("Use ↑/↓, j/k, Enter. Press q or Esc to exit."));
  lines.push(faint("Tip: time inputs accept 9am, 1:30pm, or 13:30."));
  if (message) {
    lines.push("");
    lines.push(message);
  }

  clear();
  stdout.write(`${lines.join("\n")}\n`);
}

function setRawMode(enabled) {
  if (stdin.isTTY) {
    stdin.setRawMode(enabled);
  }
}

async function promptLine(question) {
  setRawMode(false);
  stdout.write("\n");
  const rl = readlinePromises.createInterface({ input: stdin, output: stdout });

  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
    setRawMode(true);
  }
}

async function promptRequired(question) {
  const answer = await promptLine(question);
  if (!answer) {
    throw new Error(`${question.replace(/[: ]+$/, "")} is required`);
  }
  return answer;
}

async function promptTimeZone() {
  const zones = supportedTimeZones();
  const defaultZone = localTimeZone();
  let query = "";

  while (true) {
    const matches = zones.filter((zone) => zone.toLowerCase().includes(query.toLowerCase()));
    const visible = matches.slice(0, 18);

    clear();
    stdout.write(`${bright("Choose Your Time Zone")}

Time zones use this format:
  Region/City

Top-level regions in this runtime:
  ${regionSummary(zones)}

Examples:
  America/Los_Angeles
  America/New_York
  Europe/London
  Asia/Kolkata

You can type:
  - Enter to use your computer's timezone: ${defaultZone}
  - a number from the list below
  - a search term like los, london, tokyo, america, europe
  - the exact timezone if you already know it

${query ? `Search: ${query}\n` : "Showing the first supported zones. Type a search term to narrow the list.\n"}
${visible.map((zone, index) => `  ${String(index + 1).padStart(2)}. ${zone}`).join("\n")}
${matches.length > visible.length ? `\n  ...${matches.length - visible.length} more. Type a more specific search term.\n` : ""}

`);

    const answer = await promptLine(`Time zone [${defaultZone}]: `);
    if (!answer) {
      validateTimeZone(defaultZone);
      return defaultZone;
    }

    const selectedNumber = Number(answer);
    if (Number.isInteger(selectedNumber) && selectedNumber >= 1 && selectedNumber <= visible.length) {
      return visible[selectedNumber - 1];
    }

    const exact = zones.find((zone) => zone.toLowerCase() === answer.toLowerCase());
    if (exact) {
      return exact;
    }

    if (answer.includes("/")) {
      validateTimeZone(answer);
      return answer;
    }

    query = answer;
  }
}

async function promptWindow(mode) {
  const start = await promptRequired("Start time (examples: 9am, 1:30pm, 13:30): ");
  const end = await promptRequired("End time (examples: 11am, 5pm, 17:00): ");

  if (mode === "base") {
    return {
      day: (await promptRequired("Day (examples: monday, mon, friday): ")).toLowerCase(),
      start,
      end
    };
  }

  return {
    date: normalizeDateAnswer(await promptRequired("Date (today, tomorrow, or YYYY-MM-DD): ")),
    start,
    end
  };
}

async function showHelp() {
  clear();
  stdout.write(`${bright("Better Availability Help")}

Profiles are portable JSON files. Your local team directory stores your profile
plus imported teammate profiles, then overlap queries run against effective
availability.

Availability math:
  Base Availability + Added Availability - Blocked Availability = Effective Availability

Profile time zones must be real IANA identifiers such as:
  America/Los_Angeles
  America/New_York
  Europe/London
  Asia/Kolkata

Time zones are organized as Region/City. The setup flow includes a searchable
list of supported time zones.

Time inputs accept both normal and 24-hour formats:
  9am
  1:30pm
  13:30

Date inputs accept:
  today
  tomorrow
  2026-06-12

Days accept full names or short names:
  monday
  mon
  friday
  fri

Roles and tags are labels for filtering later. They are optional:
  Founder
  Frontend Developer
  designer, frontend, leadership

CLI examples:
  better-availability init --name "William" --timezone America/Los_Angeles
  better-availability import ./kelton.availability.json
  better-availability overlap --date 2026-06-09 --people william,kelton --duration 30

Press any key to return.
`);
  await waitForKey();
}

async function showOverlap() {
  const date = normalizeDateAnswer(await promptRequired("Date (today, tomorrow, or YYYY-MM-DD): "));
  const durationText = await promptLine("Minimum duration in minutes [30]: ");
  const availableProfiles = await listProfiles();
  if (availableProfiles.length > 0) {
    stdout.write(`Available profile ids: ${availableProfiles.map((profile) => profile.id).join(", ")}\n`);
  }
  const peopleText = await promptLine("Profile ids, comma-separated [all profiles]: ");
  const durationMinutes = durationText ? Number(durationText) : 30;
  const people = peopleText ? peopleText.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const profiles = await selectProfiles(people);
  const windows = findOverlapWindows(profiles, { date, durationMinutes });

  clear();
  stdout.write(`${bright(`Overlap windows for ${date}`)}\n\n`);

  if (windows.length === 0) {
    stdout.write(`No overlap windows found for ${durationMinutes} minutes.\n`);
  } else {
    for (const window of windows) {
      stdout.write(`${window.start.toISOString()} - ${window.end.toISOString()} (${window.durationMinutes} minutes)\n`);
      for (const local of window.localTimes) {
        stdout.write(`  ${local.name.padEnd(24)} ${local.start} - ${local.end} ${local.timeZone}\n`);
      }
      stdout.write("\n");
    }
  }

  stdout.write(faint("Press any key to return.\n"));
  await waitForKey();
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

async function runAction(action) {
  if (action.id === "dashboard") {
    return "Dashboard refreshed.";
  }

  if (action.id === "overlap") {
    await showOverlap();
    return "Overlap query complete.";
  }

  if (action.id === "init") {
    const name = await promptRequired("Name (example: William): ");
    const timeZone = await promptTimeZone();
    const role = await promptLine("Role [optional, examples: Founder, Frontend Developer, Designer]: ");
    const tagsText = await promptLine("Tags [optional, comma-separated, examples: frontend, leadership]: ");
    const profile = createProfile({
      name,
      timeZone,
      role,
      tags: tagsText ? tagsText.split(",").map((tag) => tag.trim()).filter(Boolean) : []
    });
    await writeMyProfile(profile);
    return `Created local profile for ${profile.name}.`;
  }

  if (action.id === "base") {
    const profile = await readMyProfile();
    await writeMyProfile(addBaseAvailability(profile, await promptWindow("base")));
    return "Base availability added.";
  }

  if (action.id === "add") {
    const profile = await readMyProfile();
    await writeMyProfile(addAvailability(profile, await promptWindow("override")));
    return "Temporary availability added.";
  }

  if (action.id === "block") {
    const profile = await readMyProfile();
    await writeMyProfile(blockAvailability(profile, await promptWindow("override")));
    return "Availability block added.";
  }

  if (action.id === "import") {
    const source = await promptRequired("Path to teammate JSON: ");
    const { profile } = await importTeammate(source);
    return `Imported ${profile.name}.`;
  }

  if (action.id === "export") {
    const target = await promptRequired("Export path: ");
    const profile = await readMyProfile();
    await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`);
    return `Exported ${profile.name} to ${target}.`;
  }

  if (action.id === "help") {
    await showHelp();
    return "";
  }

  return "quit";
}

export async function launchTui() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("The TUI requires an interactive terminal. Use `better-availability help` for command mode.");
  }

  readline.emitKeypressEvents(stdin);
  setRawMode(true);
  stdin.resume();

  let selected = 0;
  let message = "";
  let profiles = await listProfiles();

  try {
    while (true) {
      renderHome({ selected, message, profiles });
      const key = await new Promise((resolve) => {
        stdin.once("keypress", (_chunk, keypress) => resolve(keypress));
      });

      if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        break;
      }

      if (key.name === "up" || key.name === "k") {
        selected = (selected - 1 + actions.length) % actions.length;
      } else if (key.name === "down" || key.name === "j") {
        selected = (selected + 1) % actions.length;
      } else if (key.name === "return") {
        try {
          const result = await runAction(actions[selected]);
          if (result === "quit") {
            break;
          }
          message = result;
          profiles = await listProfiles();
        } catch (error) {
          message = `Error: ${error.message}`;
        }
      }
    }
  } finally {
    setRawMode(false);
    clear();
    stdin.pause();
  }
}
