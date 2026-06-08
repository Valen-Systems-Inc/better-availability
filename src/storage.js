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
    teammates: path.join(home, "profiles", "teammates"),
    state: path.join(home, "state.json")
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

export async function readState(home = availabilityHome()) {
  const store = await ensureStore(home);
  try {
    return {
      lastExportedAt: null,
      teammates: {},
      ...await readJson(store.state)
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        lastExportedAt: null,
        teammates: {}
      };
    }
    throw error;
  }
}

export async function writeState(state, home = availabilityHome()) {
  const store = await ensureStore(home);
  await fs.writeFile(store.state, `${JSON.stringify({
    lastExportedAt: state.lastExportedAt || null,
    teammates: state.teammates || {}
  }, null, 2)}\n`);
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

export async function exportMyProfile(target, home = availabilityHome()) {
  const profile = await readMyProfile(home);
  await fs.writeFile(target, `${JSON.stringify(profile, null, 2)}\n`);
  const state = await readState(home);
  state.lastExportedAt = new Date().toISOString();
  await writeState(state, home);
  return { profile, target };
}

export async function importTeammate(file, { onConflict = "replace" } = {}, home = availabilityHome()) {
  const store = await ensureStore(home);
  let profile = validateProfile(await readJson(file));
  let target = path.join(store.teammates, `${profile.id}.json`);
  const exists = await fileExists(target);

  if (exists && onConflict === "cancel") {
    return { profile, target, imported: false, conflict: true };
  }

  if (exists && onConflict === "keep-both") {
    let counter = 2;
    let candidateId = `${profile.id}-${counter}`;
    while (await fileExists(path.join(store.teammates, `${candidateId}.json`))) {
      counter += 1;
      candidateId = `${profile.id}-${counter}`;
    }
    profile = validateProfile({
      ...profile,
      id: candidateId
    });
    target = path.join(store.teammates, `${profile.id}.json`);
  }

  await writeProfile(target, profile);
  const state = await readState(home);
  state.teammates = {
    ...state.teammates,
    [profile.id]: {
      importedAt: new Date().toISOString(),
      source: file
    }
  };
  await writeState(state, home);
  return { profile, target, imported: true, conflict: exists };
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

export async function listTeammates(home = availabilityHome()) {
  const store = await ensureStore(home);
  const state = await readState(home);
  const files = await fs.readdir(store.teammates);
  const teammates = [];

  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const profile = validateProfile(await readJson(path.join(store.teammates, file)));
    teammates.push({
      profile,
      importedAt: state.teammates?.[profile.id]?.importedAt || null,
      source: state.teammates?.[profile.id]?.source || null
    });
  }

  return teammates;
}

export async function removeTeammate(id, home = availabilityHome()) {
  const store = await ensureStore(home);
  const profileId = String(id || "").trim();
  if (!profileId) {
    throw new Error("teammate id is required");
  }

  const target = path.join(store.teammates, `${profileId}.json`);
  if (!await fileExists(target)) {
    throw new Error(`No imported teammate found for ${profileId}`);
  }

  await fs.unlink(target);
  const state = await readState(home);
  if (state.teammates) {
    delete state.teammates[profileId];
  }
  await writeState(state, home);
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

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
