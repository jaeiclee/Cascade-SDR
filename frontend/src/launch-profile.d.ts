export type LaunchProfile =
  | { kind: "default" }
  | { kind: "steam-deck-iss"; mode: "sstv"; frequencyHz: number };

export function resolveLaunchProfile(search: string): LaunchProfile;
export function shouldAutoStartSstv(profile: LaunchProfile, backendMode: string): boolean;
