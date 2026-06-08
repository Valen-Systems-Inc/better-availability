import {
  addAvailability,
  addBaseAvailability,
  blockAvailability,
  createProfile,
  deleteAvailabilityWindow,
  listAvailabilityWindows,
  updateAvailabilityWindow
} from "./profile.js";
import {
  exportMyProfile,
  importTeammate,
  listProfiles,
  readMyProfile,
  removeTeammate,
  selectProfiles,
  writeMyProfile
} from "./storage.js";
import { findOverlapWindows } from "./availability.js";
import { launchTui } from "./tui.js";
import { normalizeDate } from "./time.js";

function parseArgs(args) {
  const values = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      values._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = true;
    } else {
      values[key] = next;
      index += 1;
    }
  }

  return values;
}

function requireArg(args, name) {
  if (!args[name]) {
    throw new Error(`Missing required option --${name}`);
  }
  return args[name];
}

export function helpText() {
  return `Better Availability

Usage:
  better-availability
  better-availability start
  better-availability help
  better-availability init --name "William" --timezone America/Los_Angeles [--role Founder] [--tags leadership,product]
  better-availability add-base --day monday --start 09:00 --end 11:00
  better-availability add --date 2026-06-12 --start 18:00 --end 20:00
  better-availability block --date 2026-06-10 --start 13:00 --end 15:00
  better-availability windows
  better-availability edit-window --kind base --index 0 --day monday --start 9am --end 11am
  better-availability delete-window --kind base --index 0 --yes
  better-availability remove-teammate kelton
  better-availability export ./me.availability.json
  better-availability import ./teammate.availability.json
  better-availability teammates
  better-availability overlap --date 2026-06-09 [--people william,kelton] [--duration 30]

Environment:
  BETTER_AVAILABILITY_HOME=/path/to/local/team-directory

Input formats:
  Time zones use Region/City, for example America/Los_Angeles.
  Times accept 9am, 1:30pm, 13:30, or 09:00.
  Days accept monday or mon.
  Terminal app dates accept today, tomorrow, or YYYY-MM-DD.`;
}

async function init(args) {
  const profile = createProfile({
    name: requireArg(args, "name"),
    timeZone: requireArg(args, "timezone"),
    role: args.role || "",
    tags: args.tags ? args.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : []
  });
  await writeMyProfile(profile);
  console.log(`Created local profile: ${profile.name} (${profile.timeZone})`);
}

async function addBase(args) {
  const profile = await readMyProfile();
  const next = addBaseAvailability(profile, {
    day: requireArg(args, "day"),
    start: requireArg(args, "start"),
    end: requireArg(args, "end")
  });
  await writeMyProfile(next);
  console.log(`Added ${args.day} ${args.start}-${args.end} to ${next.name}`);
}

async function add(args) {
  const profile = await readMyProfile();
  const next = addAvailability(profile, {
    date: normalizeDate(requireArg(args, "date")),
    start: requireArg(args, "start"),
    end: requireArg(args, "end")
  });
  await writeMyProfile(next);
  console.log(`Added ${args.date} ${args.start}-${args.end} to ${next.name}`);
}

async function block(args) {
  const profile = await readMyProfile();
  const next = blockAvailability(profile, {
    date: normalizeDate(requireArg(args, "date")),
    start: requireArg(args, "start"),
    end: requireArg(args, "end")
  });
  await writeMyProfile(next);
  console.log(`Blocked ${args.date} ${args.start}-${args.end} for ${next.name}`);
}

async function exportProfile(args) {
  const target = args._[1];
  const { profile, target: resolvedTarget } = await exportMyProfile(target);
  console.log(`Exported ${profile.name} to ${resolvedTarget}`);
}

async function importProfile(args) {
  const source = args._[1];
  if (!source) {
    throw new Error("Missing import file path");
  }

  const { profile, target } = await importTeammate(source);
  console.log(`Imported ${profile.name} as ${target}`);
}

async function teammates() {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    console.log("No local profiles found.");
    return;
  }

  for (const profile of profiles) {
    const tags = profile.tags.length ? ` [${profile.tags.join(", ")}]` : "";
    console.log(`${profile.id.padEnd(20)} ${profile.name.padEnd(24)} ${profile.timeZone}${tags}`);
  }
}

async function windows() {
  const profile = await readMyProfile();
  const rows = listAvailabilityWindows(profile);
  if (rows.length === 0) {
    console.log("No availability windows found.");
    return;
  }

  for (const row of rows) {
    const where = row.kind === "base" ? row.day : row.date;
    console.log(`${row.number}. ${row.kind} index=${row.index} ${where} ${row.start}-${row.end}`);
  }
}

async function editWindow(args) {
  const kind = requireArg(args, "kind");
  const index = Number(requireArg(args, "index"));
  const profile = await readMyProfile();
  const patch = {};

  if (args.type) patch.kind = args.type;
  if (args.day) patch.day = args.day;
  if (args.date) patch.date = args.date;
  if (args.start) patch.start = args.start;
  if (args.end) patch.end = args.end;

  const next = updateAvailabilityWindow(profile, { kind, index }, patch);
  await writeMyProfile(next);
  console.log("Availability window updated. Export your JSON to share this change.");
}

async function deleteWindow(args) {
  if (!args.yes) {
    throw new Error("delete-window is destructive. Re-run with --yes after checking `better-availability windows`.");
  }
  const kind = requireArg(args, "kind");
  const index = Number(requireArg(args, "index"));
  const next = deleteAvailabilityWindow(await readMyProfile(), { kind, index });
  await writeMyProfile(next);
  console.log("Availability window deleted. Export your JSON to share this change.");
}

async function removeTeammateCommand(args) {
  const id = args._[1];
  if (!id) {
    throw new Error("Missing teammate id");
  }
  await removeTeammate(id);
  console.log(`Removed teammate ${id} from the local team directory.`);
}

async function overlap(args) {
  const date = normalizeDate(requireArg(args, "date"));
  const durationMinutes = args.duration ? Number(args.duration) : 30;
  const people = args.people ? args.people.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const profiles = await selectProfiles(people);
  const windows = findOverlapWindows(profiles, { date, durationMinutes });

  if (windows.length === 0) {
    console.log(`No shared windows found on ${date} for ${durationMinutes} minutes.`);
    console.log(`People: ${profiles.map((profile) => profile.name).join(", ")}`);
    console.log("Try reducing duration, removing one teammate, checking stale profiles, or viewing each person's availability.");
    return;
  }

  for (const window of windows) {
    console.log(`\n${window.start.toISOString()} - ${window.end.toISOString()} (${window.durationMinutes} minutes)`);
    for (const local of window.localTimes) {
      console.log(`  ${local.name.padEnd(24)} ${local.start} - ${local.end} ${local.timeZone}`);
    }
  }
}

export async function runCli(rawArgs) {
  const args = parseArgs(rawArgs);
  const command = args._[0] || "tui";

  if (command === "help" || args.help) {
    console.log(helpText());
  } else if (command === "start" || command === "tui") {
    await launchTui();
  } else if (command === "init") {
    await init(args);
  } else if (command === "add-base") {
    await addBase(args);
  } else if (command === "add") {
    await add(args);
  } else if (command === "block") {
    await block(args);
  } else if (command === "windows") {
    await windows();
  } else if (command === "edit-window") {
    await editWindow(args);
  } else if (command === "delete-window") {
    await deleteWindow(args);
  } else if (command === "remove-teammate") {
    await removeTeammateCommand(args);
  } else if (command === "export") {
    await exportProfile(args);
  } else if (command === "import") {
    await importProfile(args);
  } else if (command === "teammates") {
    await teammates();
  } else if (command === "overlap") {
    await overlap(args);
  } else {
    throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
  }
}
