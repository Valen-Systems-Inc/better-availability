import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  addAvailability,
  addBaseAvailability,
  blockAvailability,
  createProfile
} from "./profile.js";
import {
  importTeammate,
  listProfiles,
  readMyProfile,
  selectProfiles,
  writeMyProfile
} from "./storage.js";
import { findOverlapWindows } from "./availability.js";
import { launchTui } from "./tui.js";

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
  better-availability export ./me.availability.json
  better-availability import ./teammate.availability.json
  better-availability teammates
  better-availability overlap --date 2026-06-09 [--people william,kelton] [--duration 30]

Environment:
  BETTER_AVAILABILITY_HOME=/path/to/local/team-directory`;
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
    date: requireArg(args, "date"),
    start: requireArg(args, "start"),
    end: requireArg(args, "end")
  });
  await writeMyProfile(next);
  console.log(`Added ${args.date} ${args.start}-${args.end} to ${next.name}`);
}

async function block(args) {
  const profile = await readMyProfile();
  const next = blockAvailability(profile, {
    date: requireArg(args, "date"),
    start: requireArg(args, "start"),
    end: requireArg(args, "end")
  });
  await writeMyProfile(next);
  console.log(`Blocked ${args.date} ${args.start}-${args.end} for ${next.name}`);
}

async function exportProfile(args) {
  const target = args._[1];
  if (!target) {
    throw new Error("Missing export file path");
  }

  const profile = await readMyProfile();
  await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`);
  console.log(`Exported ${profile.name} to ${target}`);
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

async function overlap(args) {
  const date = requireArg(args, "date");
  const durationMinutes = args.duration ? Number(args.duration) : 30;
  const people = args.people ? args.people.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const profiles = await selectProfiles(people);
  const windows = findOverlapWindows(profiles, { date, durationMinutes });

  if (windows.length === 0) {
    console.log(`No overlap windows found on ${date} for ${durationMinutes} minutes.`);
    return;
  }

  for (const window of windows) {
    console.log(`\n${window.start.toISOString()} - ${window.end.toISOString()} (${window.durationMinutes} minutes)`);
    for (const local of window.localTimes) {
      console.log(`  ${local.name.padEnd(24)} ${local.start} - ${local.end} ${local.timeZone}`);
    }
  }
}

async function promptForWindow(rl, mode) {
  const start = await rl.question("Start time (HH:mm): ");
  const end = await rl.question("End time (HH:mm): ");

  if (mode === "base") {
    return {
      day: (await rl.question("Day (monday-sunday): ")).toLowerCase(),
      start,
      end
    };
  }

  return {
    date: await rl.question("Date (YYYY-MM-DD): "),
    start,
    end
  };
}

async function menu() {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("Better Availability\n");
    console.log("1. View teammates");
    console.log("2. Add base availability");
    console.log("3. Add temporary availability");
    console.log("4. Block availability");
    console.log("5. Query overlap");
    console.log("6. Help");
    const choice = await rl.question("\nChoose: ");

    if (choice === "1") {
      await teammates();
    } else if (choice === "2") {
      const profile = await readMyProfile();
      await writeMyProfile(addBaseAvailability(profile, await promptForWindow(rl, "base")));
      console.log("Base availability added.");
    } else if (choice === "3") {
      const profile = await readMyProfile();
      await writeMyProfile(addAvailability(profile, await promptForWindow(rl, "override")));
      console.log("Temporary availability added.");
    } else if (choice === "4") {
      const profile = await readMyProfile();
      await writeMyProfile(blockAvailability(profile, await promptForWindow(rl, "override")));
      console.log("Availability blocked.");
    } else if (choice === "5") {
      const date = await rl.question("Date (YYYY-MM-DD): ");
      const duration = Number(await rl.question("Minimum duration in minutes: ") || "30");
      const peopleInput = await rl.question("Profile ids, comma-separated (blank for all): ");
      await overlap(parseArgs([
        "overlap",
        "--date",
        date,
        "--duration",
        String(duration),
        ...(peopleInput.trim() ? ["--people", peopleInput] : [])
      ]));
    } else {
      console.log(helpText());
    }
  } finally {
    rl.close();
  }
}

export async function runCli(rawArgs) {
  const args = parseArgs(rawArgs);
  const command = args._[0] || "tui";

  if (command === "help" || args.help) {
    console.log(helpText());
  } else if (command === "start" || command === "tui") {
    await launchTui();
  } else if (command === "menu") {
    await menu();
  } else if (command === "init") {
    await init(args);
  } else if (command === "add-base") {
    await addBase(args);
  } else if (command === "add") {
    await add(args);
  } else if (command === "block") {
    await block(args);
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
