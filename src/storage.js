import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { validateProfile } from "./profile.js";

export function availabilityHome() {
  return process.env.BETTER_AVAILABILITY_HOME || path.join(homedir(), ".better-availability");
}

export function paths(home = availabilityHome()) {
  return {
    home,
    profiles: path.join(home, "profiles"),
    me: path.join(home, "profiles", "me.json"),
    teammates: path.join(home, "profiles", "teammates")
  };
}

export async function ensureStore(home = availabilityHome()) {
  const store = paths(home);
  await fs.mkdir(store.teammates, { recursive: true });
  return store;
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeProfile(file, profile) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(validateProfile(profile), null, 2)}\n`);
}

export async function readMyProfile(home = availabilityHome()) {
  const store = await ensureStore(home);
  return validateProfile(await readJson(store.me));
}

export async function writeMyProfile(profile, home = availabilityHome()) {
  const store = await ensureStore(home);
  await writeProfile(store.me, profile);
}

export async function importTeammate(file, home = availabilityHome()) {
  const store = await ensureStore(home);
  const profile = validateProfile(await readJson(file));
  const target = path.join(store.teammates, `${profile.id}.json`);
  await writeProfile(target, profile);
  return { profile, target };
}

export async function listProfiles(home = availabilityHome()) {
  const store = await ensureStore(home);
  const profiles = [];

  try {
    profiles.push(await readMyProfile(home));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const files = await fs.readdir(store.teammates);
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    profiles.push(validateProfile(await readJson(path.join(store.teammates, file))));
  }

  return profiles;
}

export async function selectProfiles(ids, home = availabilityHome()) {
  const profiles = await listProfiles(home);
  if (!ids || ids.length === 0) {
    return profiles;
  }

  const wanted = new Set(ids);
  const selected = profiles.filter((profile) => wanted.has(profile.id));
  const found = new Set(selected.map((profile) => profile.id));
  const missing = [...wanted].filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw new Error(`No imported profile found for: ${missing.join(", ")}`);
  }

  return selected;
}
