import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProfile } from "../src/profile.js";
import {
  exportMyProfile,
  importTeammate,
  listTeammates,
  readState,
  removeTeammate,
  writeMyProfile
} from "../src/storage.js";

async function tempHome(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

test("export tracks last exported time in local state", async () => {
  const home = await tempHome("better-availability-export");
  const profile = createProfile({
    name: "William",
    timeZone: "America/Los_Angeles"
  });
  await writeMyProfile(profile, home);
  await exportMyProfile(path.join(home, "william.json"), home);
  const state = await readState(home);

  assert.ok(state.lastExportedAt);
});

test("teammate import can keep both conflicting profiles and remove one", async () => {
  const home = await tempHome("better-availability-import");
  const source = path.join(home, "kelton.json");
  const profile = createProfile({
    name: "Kelton",
    timeZone: "America/New_York"
  });
  await fs.writeFile(source, `${JSON.stringify(profile, null, 2)}\n`);

  await importTeammate(source, {}, home);
  await importTeammate(source, { onConflict: "keep-both" }, home);
  let teammates = await listTeammates(home);

  assert.deepEqual(teammates.map((item) => item.profile.id).sort(), ["kelton", "kelton-2"]);
  assert.ok(teammates.every((item) => item.importedAt));

  await removeTeammate("kelton-2", home);
  teammates = await listTeammates(home);

  assert.deepEqual(teammates.map((item) => item.profile.id), ["kelton"]);
});
