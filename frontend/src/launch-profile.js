export function resolveLaunchProfile(search) {
  const profile = new URLSearchParams(search).get("profile");
  if (profile !== "steam-deck-iss") return { kind: "default" };
  return {
    kind: "steam-deck-iss",
    mode: "sstv",
    frequencyHz: 437_550_000,
  };
}

export function shouldAutoStartSstv(profile, backendMode) {
  return profile.kind === "steam-deck-iss" && backendMode === "idle";
}
