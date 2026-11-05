/** WebKit's Audio Session API, not yet in TypeScript's DOM types. */
interface AudioSessionNavigator {
  audioSession: { type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record' };
}

/**
 * Safari plays Web Audio in the "ambient" session by default, which the iPhone's silent switch
 * mutes. "playback" plays through it, as the iOS app does; it can also pause audio another app
 * is playing. Browsers without the API are left as they are.
 */
function requestPlaybackAudioSession(): void {
  if (typeof navigator === 'undefined' || !('audioSession' in navigator)) return;
  try {
    (navigator as Navigator & AudioSessionNavigator).audioSession.type = 'playback';
  } catch {
    console.warn('Failed to set the audio session to playback');
  }
}

function createAudioContext(): AudioContext {
  requestPlaybackAudioSession();
  return new AudioContext({ latencyHint: 'interactive', sampleRate: 44100 });
}

interface PreparedContext {
  context: AudioContext;
  /** The suspension that parks the started context until a pack takes it. */
  parking: Promise<void> | null;
}

let prepared: PreparedContext | null = null;

/**
 * Safari on iPhone and iPad starts an AudioContext only inside a tap or a click: not when a touch
 * begins and not when a long press ends. A pack's sounds are set up after its file is read, outside
 * the tap that opened it, so their context began suspended and every press stayed silent until the
 * player's first short tap, which itself was lost. Call this synchronously from the tap that opens
 * a pack (before any await): it starts the context the next pack takes and parks it suspended until
 * then. A context started once in a tap resumes later without one.
 */
export function prepareAudioContext(): void {
  if (typeof AudioContext === 'undefined') return;
  const entry = prepared ??= { context: createAudioContext(), parking: null };
  const { context } = entry;
  if (context.state === 'running') return;
  void context.resume().then(() => {
    if (prepared === entry) entry.parking = context.suspend().catch(() => {});
  }, () => {});
}

/**
 * The context a pack's sounds play through: the one a tap prepared, or a new one. `ready` settles
 * once a parking suspension still in flight has finished, so a resume requested after it sticks.
 */
export function takeAudioContext(): { context: AudioContext; ready: Promise<void> | null } {
  const entry = prepared;
  prepared = null;
  if (!entry) return { context: createAudioContext(), ready: null };
  return { context: entry.context, ready: entry.parking };
}
