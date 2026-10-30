import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLaunchProfile, shouldAutoStartSstv } from "../src/launch-profile.js";

test("the ordinary desktop URL keeps the default startup profile", () => {
  assert.deepEqual(resolveLaunchProfile(""), { kind: "default" });
});

test("the Steam Deck profile starts SSTV on its ISS preset", () => {
  assert.deepEqual(resolveLaunchProfile("?profile=steam-deck-iss"), {
    kind: "steam-deck-iss",
    mode: "sstv",
    frequencyHz: 437_550_000,
  });
});

test("unknown launch profiles fall back to the ordinary desktop profile", () => {
  assert.deepEqual(resolveLaunchProfile("?profile=typo"), { kind: "default" });
});

test("the Steam Deck profile starts SSTV when the backend is idle", () => {
  const profile = resolveLaunchProfile("?profile=steam-deck-iss");
  assert.equal(shouldAutoStartSstv(profile, "idle"), true);
});

test("the Steam Deck profile does not replace a mode already running", () => {
  const profile = resolveLaunchProfile("?profile=steam-deck-iss");
  assert.equal(shouldAutoStartSstv(profile, "sstv"), false);
});

test("the ordinary desktop profile does not auto-start SSTV", () => {
  const profile = resolveLaunchProfile("");
  assert.equal(shouldAutoStartSstv(profile, "idle"), false);
});
