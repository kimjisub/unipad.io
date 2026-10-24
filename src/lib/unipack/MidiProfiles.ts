/** Device names stay untranslated; the two descriptive entries carry a key
 *  so they read in the user's language. */
const profiles = [
  { value: 'auto', label: 'Auto Detect', labelKey: 'autoDetect' },
  { value: 'launchpad_s', label: 'Launchpad S' },
  { value: 'launchpad_mk2', label: 'Launchpad MK2' },
  { value: 'launchpad_pro', lightingInterface: 2, label: 'Launchpad Pro (Original)' },
  { value: 'launchpad_pro_cfw', label: 'Launchpad Pro (Launchpad Open)' },
  { value: 'launchpad_corefw', label: 'Launchpad CoreFW (RGB)' },
  { value: 'launchpad_corefw_rg', label: 'Launchpad CoreFW (S / Mini)' },
  { value: 'launchpad_x', lightingInterface: 2, label: 'Launchpad X' },
  { value: 'launchpad_mini_mk3', lightingInterface: 2, label: 'Launchpad Mini MK3' },
  { value: 'launchpad_pro_mk3', lightingInterface: 1, label: 'Launchpad Pro MK3' },
  { value: 'midifighter', label: 'Midi Fighter' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'master_keyboard', label: 'Master Keyboard' },
  { value: 'none', label: 'No Init SysEx', labelKey: 'noInitSysEx' },
] as const;

export type LaunchpadProfile = typeof profiles[number]['value'];

export const LAUNCHPAD_PROFILE_OPTIONS: ReadonlyArray<{
  value: LaunchpadProfile;
  label: string;
  labelKey?: 'autoDetect' | 'noInitSysEx';
}> = profiles;

export function isLaunchpadProfile(value: unknown): value is LaunchpadProfile {
  return profiles.some(profile => profile.value === value);
}

const lightingInterfaces: Partial<Record<LaunchpadProfile, number>> = Object.fromEntries(
  profiles.flatMap(profile => 'lightingInterface' in profile ? [[profile.value, profile.lightingInterface]] : []),
);

/** One-based stock interface numbers from the model's programmer reference. */
export function getLightingInterface(profile: LaunchpadProfile): number | undefined {
  return lightingInterfaces[profile];
}
