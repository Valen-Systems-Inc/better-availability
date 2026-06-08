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
    return ["No local profiles yet. Create your profile or import teammate JSON."];
  }

  return profiles.map((profile) => {
    const tags = profile.tags.length ? `  [${profile.tags.join(", ")}]` : "";
    return trimLine(`${profile.id.padEnd(18)} ${profile.name.padEnd(22)} ${profile.timeZone}${tags}`, width);
  });
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

async function promptWindow(mode) {
  const start = await promptRequired("Start time (HH:mm): ");
  const end = await promptRequired("End time (HH:mm): ");

  if (mode === "base") {
    return {
      day: (await promptRequired("Day (monday-sunday): ")).toLowerCase(),
      start,
      end
    };
  }

  return {
    date: await promptRequired("Date (YYYY-MM-DD): "),
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

CLI examples:
  better-availability init --name "William" --timezone America/Los_Angeles
  better-availability import ./kelton.availability.json
  better-availability overlap --date 2026-06-09 --people william,kelton --duration 30

Press any key to return.
`);
  await waitForKey();
}

async function showOverlap() {
  const date = await promptRequired("Date (YYYY-MM-DD): ");
  const durationText = await promptLine("Minimum duration in minutes [30]: ");
  const peopleText = await promptLine("Profile ids, comma-separated [all]: ");
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
    const name = await promptRequired("Name: ");
    const timeZone = await promptRequired("Time zone: ");
    const role = await promptLine("Role [blank]: ");
    const tagsText = await promptLine("Tags, comma-separated [blank]: ");
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
