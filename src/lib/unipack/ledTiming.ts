// Measures whether the LED commands autoplay sends to the launchpad keep the order and timing the pack
// asks for. Test tooling only: the browser test e2e/led-timing.spec.ts compares what the player's
// MIDI output was handed with the timeline computed here; nothing in the player imports this.
import type { LedAnimation, UniPackData } from './types';

/** A launchpad LED as LedRunner addresses it: a pad, or a round button or the logo when `x` is -1. */
export interface LedTarget {
  x: number;
  y: number;
}

/** `code` (a palette velocity, 0 for off) on `target`, `ms` after autoplay starts. */
export interface LedCommand extends LedTarget {
  ms: number;
  code: number;
  /** An animation step in an intended timeline: the animation (one per press) it belongs to. */
  animation?: number;
  /** When the same pad's next press, or a release of an endless animation, ends that animation: a step
   *  delayed past this is cut off by it. Infinity when nothing does. */
  cutMs?: number;
}

export interface IntendedTimeline {
  commands: LedCommand[];
  /** When autoplay plays its last element and ends: the sum of the delays before that element. */
  autoPlayLengthMs: number;
  /** Endless animations with no delay in a pass; LedRunner plays them a pass per tick, which no timeline can state. */
  delaylessEndlessAnimations: number;
  /** Endless animations that did not yield to the final release; truncated there. */
  unreleasedEndlessAnimations: number;
  /** Chain changes inside LED animations, which this timeline does not follow. */
  ledChainEvents: number;
}

/** Missing and extra commands always fail. Only an order difference caused entirely by autoplay's
 * final redraw overtaking late steps can be inconclusive after an excessive stall. */
export function denseTimingVerdict(
  result: Pick<LedTimingResult, 'reordered' | 'missing' | 'extra'>,
  timerSpanMs: number,
  slackMs: number,
  stallExplained: boolean,
): 'pass' | 'fail' | 'inconclusive' {
  if (result.extra > 0 || result.missing > 0) return 'fail';
  if (result.reordered === 0 && result.missing === 0) return 'pass';
  return timerSpanMs > slackMs && stallExplained ? 'inconclusive' : 'fail';
}

/** The longest span of three consecutive `ticks` (ascending) of a timer as frequent as LedRunner's that
 * overlaps `from`..`to`: how long a press could wait in it for LedRunner to start its animation and play a
 * step. */
export function longestTimerSpan(ticks: readonly number[], from: number, to: number): number {
  let first = 0;
  let end = Math.max(0, ticks.length - 3);
  while (first < end) {
    const middle = (first + end) >> 1;
    if (ticks[middle + 3] < from) first = middle + 1;
    else end = middle;
  }
  let longest = 0;
  for (let i = first; i + 3 < ticks.length && ticks[i] <= to; i++) longest = Math.max(longest, ticks[i + 3] - ticks[i]);
  return longest;
}

/** Whether a timer as frequent as LedRunner's, ticking at `ticks` (ascending), stalled from `from` until
 * `to`: four consecutive ticks span both, so the page's timers ran at most three times in between, as few as
 * a step due at `from` can take to be sent: autoplay's run that presses the pad, LedRunner's that takes in
 * the new animation, and LedRunner's that plays it. */
export function stalledThrough(ticks: readonly number[], from: number, to: number): boolean {
  if (to <= from) return true;
  let after = 0;
  let end = ticks.length;
  while (after < end) {
    const middle = (after + end) >> 1;
    if (ticks[middle] <= from) after = middle + 1;
    else end = middle;
  }
  return after > 0 && after + 3 < ticks.length && ticks[after + 3] >= to;
}

/** Whether every order difference is the final redraw overtaking late animation steps. Represses
 * cannot explain missing or interleaved steps: LedRunner drains their earlier scheduled work first. */
export function stallExplains(expected: readonly LedCommand[], arrived: readonly LedCommand[], ticks: readonly number[]): boolean {
  const wantByLed = groupByLed(expected);
  const gotByLed = groupByLed(arrived);
  // One autoplay start has to explain every LED.
  let starts = autoPlayStarts(wantByLed, gotByLed, ticks);
  for (const key of new Set([...wantByLed.keys(), ...gotByLed.keys()])) {
    const want = wantByLed.get(key) ?? [];
    const got = gotByLed.get(key) ?? [];
    const same = want.length === got.length && want.every((c, i) => c.code === got[i].code);
    if (!same) starts = starts.filter((startMs) => stallExplainsLed(want, got, ticks, startMs));
    if (starts.length === 0) return false;
  }
  return true;
}

/** Autoplay keeps time from when it starts, which can be later than the click the record counts from: the
 * times, a millisecond apart, it can have started at. It starts in the task that sends the redraw switching
 * the mode, each LED's first command, right after it; its first tick sends the next redraw. No timer runs
 * inside a task, so it started before the first tick of `ticks` after that redraw too. */
function autoPlayStarts(wantByLed: Map<string, LedCommand[]>, gotByLed: Map<string, LedCommand[]>, ticks: readonly number[]): number[] {
  const startRedraw = (want: readonly LedCommand[], got: readonly LedCommand[] | undefined, i: number) =>
    want[i]?.ms === 0 && want[i].animation === undefined && got?.[i]?.code === want[i].code ? got[i].ms : undefined;
  let from = 0;
  let to = Infinity;
  for (const [key, want] of wantByLed) {
    from = Math.max(from, startRedraw(want, gotByLed.get(key), 0) ?? 0);
    to = Math.min(to, startRedraw(want, gotByLed.get(key), 1) ?? Infinity);
  }
  to = Math.min(to, ticks.find((t) => t > from) ?? Infinity);
  if (!(to > from) || to === Infinity) return [from];
  return [...Array.from({ length: Math.ceil(to - from) }, (_, i) => from + i), to];
}

/** One LED's intended commands in runs: an animation's consecutive steps, or the commands between them
 * that belong to no animation (redraws, and the offs a press or release sends). */
interface CommandRun {
  animation?: number;
  commands: LedCommand[];
}

function runsOf(want: readonly LedCommand[]): CommandRun[] {
  const runs: CommandRun[] = [];
  for (const command of want) {
    const run = runs.at(-1);
    if (run && run.animation === command.animation) run.commands.push(command);
    else runs.push({ animation: command.animation, commands: [command] });
  }
  return runs;
}

/** LedRunner's tick. It schedules the next tick that long after one ends, so a later tick's commands
 * arrive at least NEXT_TICK_MS (the tick, less timer rounding) after an earlier tick's. */
export const LED_TICK_MS = 4;
const NEXT_TICK_MS = LED_TICK_MS - 1;

/** One LED's complete animation runs, with only a final redraw allowed to overtake their tail. */
function stallExplainsLed(want: readonly LedCommand[], got: readonly LedCommand[], ticks: readonly number[], startMs: number): boolean {
  if (want.length !== got.length) return false;
  const runs = runsOf(want);
  const failed = new Set<string>();
  const arrivedAt = (commands: readonly LedCommand[], j: number) =>
    commands.every((c, k) => got[j + k]?.code === c.code && got[j + k].ms >= c.ms + (j + k === 0 ? 0 : startMs));
  const heldBack = (dueMs: number, untilMs: number) =>
    untilMs - dueMs <= OVERTAKE_MS || stalledThrough(ticks, dueMs, untilMs - OVERTAKE_MS);
  const visit = (r: number, j: number): boolean => {
    if (r === runs.length) return j === got.length;
    const key = `${r} ${j}`;
    if (failed.has(key)) return false;
    const { animation, commands } = runs[r];
    if (arrivedAt(commands, j) && visit(r + 1, j + commands.length)) return true;
    // Autoplay's final redraw is outside LedRunner. A stalled tick can still send its tail after it.
    const redraws = r + 2 === runs.length && runs[r + 1]?.animation === undefined ? runs[r + 1].commands : undefined;
    if (animation !== undefined && redraws) {
      for (let kept = 0; kept < commands.length; kept++) {
        const next = j + kept;
        if (!arrivedAt(commands.slice(0, kept), j)) break;
        const rest = next + redraws.length;
        if (arrivedAt(redraws, next) && got[next].ms >= redraws[0].ms + startMs &&
            heldBack(commands[kept].ms + startMs, got[next].ms) &&
            arrivedAt(commands.slice(kept), rest) &&
            (kept === 0 || got[rest].ms >= got[next - 1].ms + NEXT_TICK_MS) &&
            visit(r + 2, rest + commands.length - kept)) return true;
      }
    }
    failed.add(key);
    return false;
  };
  return visit(0, 0);
}

/** Why the ideal timeline cannot support an order/completeness assertion for this pack. */
export function timelineMeasurementLimit(timeline: IntendedTimeline): string | undefined {
  if (timeline.unreleasedEndlessAnimations > 0 || timeline.delaylessEndlessAnimations > 0) {
    return 'the pack has endless animations with no finite measurable tail';
  }
  if (timeline.ledChainEvents > 0) return 'the intended timeline does not follow chain changes in LED files';
  return undefined;
}

export const isPad = (target: LedTarget) => target.x !== -1;

const targetKey = (target: LedTarget) => `${target.x},${target.y}`;

/** Each LED's commands, in order. */
function groupByLed(commands: readonly LedCommand[]): Map<string, LedCommand[]> {
  const byLed = new Map<string, LedCommand[]>();
  for (const command of commands) {
    const key = targetKey(command);
    let list = byLed.get(key);
    if (!list) byLed.set(key, list = []);
    list.push(command);
  }
  return byLed;
}

/** MIDIOutput data bytes, as MidiConnection clamps a code before sending it. */
const sentCode = (code: number) => Math.max(0, Math.min(127, Math.trunc(Number.isFinite(code) ? code : 0)));

/**
 * The LED commands the play screen sends when autoplay plays `pack` with no lag: each autoplay element
 * at the sum of the delays before it, and each keyLED event at its press time plus the delays before it
 * in the animation. Animations follow LedRunner: an LED belongs to the pad and chain whose animation lit
 * it last and only that owner's off turns it off; a press ends the running animation of the same pad
 * and chain and turns off every LED it owns; a release ends only endless (loop 0) animations. The play
 * screen redraws every pad twice as autoplay starts (switching the mode, then autoplay's first tick
 * clearing the guide) and once as it ends (clearing the guide), preserving finite animation lights.
 * The end first releases autoplay's pads, including endless animations from earlier chains. Events due in the same
 * millisecond play animations in press order, then autoplay.
 */
export function intendedTimeline(pack: UniPackData): IntendedTimeline {
  return new TimelineSimulation(pack).run();
}

interface Owner { x: number; y: number; chain: number }

interface Animation {
  id: number;
  owner: Owner;
  led: LedAnimation;
  due: number;
  index: number;
  loopProgress: number;
  playing: boolean;
  /** See LedCommand.cutMs. */
  cutMs: number;
}

const sameOwner = (a: Owner | null | undefined, b: Owner) => !!a && a.x === b.x && a.y === b.y && a.chain === b.chain;

class TimelineSimulation {
  private readonly buttonX: number;
  private readonly buttonY: number;
  private readonly chainCount: number;
  /** The pack's multi-mapping queues, copied so that rotating them leaves the pack as it was. */
  private readonly table: (LedAnimation[] | null)[][][] | null;
  private readonly pads: (Owner | null)[][];
  private readonly padCodes: number[][];
  private readonly rounds = new Map<number, Owner>();
  private running: Animation[] = [];
  private readonly animations: Animation[] = [];
  private readonly lastByOwner = new Map<string, Animation>();
  private readonly out: LedCommand[] = [];
  private delayless = 0;
  private chain = 0;

  constructor(private readonly pack: UniPackData) {
    ({ buttonX: this.buttonX, buttonY: this.buttonY, chain: this.chainCount } = pack.info);
    this.table = pack.ledAnimationTable?.map((xs) => xs.map((ys) => ys.map((anims) => anims && [...anims]))) ?? null;
    this.pads = Array.from({ length: this.buttonX }, () => Array.from({ length: this.buttonY }, () => null));
    this.padCodes = Array.from({ length: this.buttonX }, () => Array.from({ length: this.buttonY }, () => 0));
  }

  run(): IntendedTimeline {
    const elements = this.pack.autoPlay?.elements ?? [];
    let next = 0;
    let autoPlayTime = 0;
    let ended = false;
    let unreleasedEndlessAnimations = 0;
    this.repaintPads(0);
    this.repaintPads(0);
    for (;;) {
      // AutoPlayRunner ends as it reaches the last element, so a delay there is never waited for.
      while (next < elements.length - 1) {
        const element = elements[next];
        if (element.type !== 'delay') break;
        autoPlayTime += element.delay;
        next++;
      }
      const autoPlayDue = ended ? Infinity : autoPlayTime;
      const animationDue = this.running.reduce((due, a) => Math.min(due, a.due), Infinity);
      const t = Math.min(autoPlayDue, animationDue);
      if (t === Infinity) break;

      for (const animation of [...this.running]) if (animation.due <= t) this.play(animation, t);
      this.running = this.running.filter((a) => a.playing);

      if (autoPlayDue === t) {
        while (next < elements.length && (elements[next].type !== 'delay' || next === elements.length - 1)) {
          this.apply(elements[next++], t);
        }
        if (next >= elements.length) {
          for (let x = 0; x < this.buttonX; x++) for (let y = 0; y < this.buttonY; y++) this.release(x, y, t);
          this.repaintPads(t);
          // Keep the bound for malformed animations that do not yield to a release.
          unreleasedEndlessAnimations = this.running.filter((a) => a.playing && a.led.loop === 0).length;
          this.running = this.running.filter((a) => a.led.loop !== 0);
          ended = true;
        }
      }
    }
    for (const command of this.out) {
      if (command.animation !== undefined) command.cutMs = this.animations[command.animation].cutMs;
    }
    return {
      commands: this.out,
      autoPlayLengthMs: autoPlayTime,
      delaylessEndlessAnimations: this.delayless,
      unreleasedEndlessAnimations,
      ledChainEvents: this.countLedChainEvents(),
    };
  }

  private apply(element: NonNullable<UniPackData['autoPlay']>['elements'][number], t: number): void {
    switch (element.type) {
      case 'on':
        this.setChain(element.currChain);
        this.pushToNum(element.x, element.y, element.num);
        this.press(element.x, element.y, t);
        break;
      case 'off':
        this.setChain(element.currChain);
        this.release(element.x, element.y, t);
        break;
      case 'chain':
        this.setChain(element.c);
        break;
      case 'delay':
        break;
    }
  }

  /** The play screen's setChain: a chain that is not a whole number is ignored, others are clamped. */
  private setChain(c: number): void {
    if (Number.isInteger(c)) this.chain = Math.max(0, Math.min(c, this.chainCount - 1));
  }

  private queue(x: number, y: number): LedAnimation[] | null | undefined {
    return this.table?.[this.chain]?.[x]?.[y];
  }

  /** The play screen's ledPushToNum: autoplay names which of a pad's animations it presses. */
  private pushToNum(x: number, y: number, num: number): void {
    const anims = this.queue(x, y);
    if (!anims || anims.length === 0) return;
    const targetNum = num % anims.length;
    for (let i = 0; i < anims.length; i++) {
      if (anims[0].num === targetNum) break;
      anims.push(anims.shift()!);
    }
  }

  private press(x: number, y: number, t: number): void {
    const owner = { x, y, chain: this.chain };
    const ownerKey = `${x},${y},${this.chain}`;
    const previous = this.lastByOwner.get(ownerKey);
    if (previous) previous.cutMs = Math.min(previous.cutMs, t);
    this.end(t, (a) => sameOwner(a.owner, owner));
    const anims = this.queue(x, y);
    const led = anims?.[0];
    if (anims && anims.length > 1) anims.push(anims.shift()!);
    if (led) {
      const animation = { id: this.animations.length, owner, led, due: t, index: 0, loopProgress: 0, playing: true, cutMs: Infinity };
      this.animations.push(animation);
      this.lastByOwner.set(ownerKey, animation);
      this.running.push(animation);
    }
  }

  private release(x: number, y: number, t: number): void {
    this.end(t, (a) => a.owner.x === x && a.owner.y === y && a.led.loop === 0);
  }

  private end(t: number, which: (a: Animation) => boolean): void {
    const ended = this.running.filter(which);
    for (const animation of ended) {
      animation.cutMs = Math.min(animation.cutMs, t);
      for (let x = 0; x < this.buttonX; x++) {
        for (let y = 0; y < this.buttonY; y++) {
          if (sameOwner(this.pads[x][y], animation.owner)) {
            this.out.push({ ms: t, x, y, code: 0 });
            this.pads[x][y] = null;
            this.padCodes[x][y] = 0;
          }
        }
      }
      for (const [y, owner] of [...this.rounds]) {
        if (sameOwner(owner, animation.owner)) {
          this.out.push({ ms: t, x: -1, y, code: 0 });
          this.rounds.delete(y);
        }
      }
    }
    this.running = this.running.filter((a) => !ended.includes(a));
  }

  /** Guide removal redraws the current pack light instead of clearing it. */
  private repaintPads(t: number): void {
    for (let x = 0; x < this.buttonX; x++) for (let y = 0; y < this.buttonY; y++) this.out.push({ ms: t, x, y, code: this.padCodes[x][y] });
  }

  /** One animation's events due by `t`, as LedRunner.loop plays one state. */
  private play(animation: Animation, t: number): void {
    const events = animation.led.ledEvents;
    if (events.length === 0) {
      animation.playing = false;
      return;
    }
    const budget = events.length * Math.max(1, animation.led.loop) + 1;
    let played = 0;
    // LedRunner ends a finite animation after a pass that started in this tick and took no time.
    let passStart = animation.index === 0 ? animation.due : NaN;
    for (;;) {
      if (animation.index >= events.length) {
        animation.loopProgress++;
        animation.index = 0;
        if (animation.led.loop !== 0 && animation.due <= passStart) {
          animation.playing = false;
          return;
        }
        passStart = animation.due;
      }
      if (animation.led.loop !== 0 && animation.led.loop <= animation.loopProgress) {
        animation.playing = false;
        return;
      }
      if (animation.due > t) return;
      // Only an endless animation whose pass has no delay gets here, LedRunner's cap for it.
      if (++played > budget) {
        this.delayless++;
        animation.playing = false;
        return;
      }
      const event = events[animation.index];
      if (event.type === 'on') this.light(event.x, event.y, event.velocity, animation, t);
      else if (event.type === 'off') this.dim(event.x, event.y, animation, t);
      else if (event.type === 'delay') animation.due += event.delay;
      animation.index++;
    }
  }

  private light(x: number, y: number, velocity: number, animation: Animation, t: number): void {
    if (x === -1) {
      this.rounds.set(y, animation.owner);
    } else {
      if (this.pads[x]?.[y] === undefined) return;
      this.pads[x][y] = animation.owner;
      this.padCodes[x][y] = sentCode(velocity);
    }
    this.out.push({ ms: t, x, y, code: sentCode(velocity), animation: animation.id });
  }

  private dim(x: number, y: number, animation: Animation, t: number): void {
    if (x === -1) {
      if (!sameOwner(this.rounds.get(y), animation.owner)) return;
      this.rounds.delete(y);
    } else {
      if (!sameOwner(this.pads[x]?.[y], animation.owner)) return;
      this.pads[x][y] = null;
      this.padCodes[x][y] = 0;
    }
    this.out.push({ ms: t, x, y, code: 0, animation: animation.id });
  }

  private countLedChainEvents(): number {
    let count = 0;
    for (const xs of this.pack.ledAnimationTable ?? []) {
      for (const ys of xs) for (const anims of ys) for (const anim of anims ?? []) {
        count += anim.ledEvents.filter((e) => e.type === 'chain').length;
      }
    }
    return count;
  }
}

/** The most commands within any 1000 ms. */
export function peakPerSecond(commands: readonly LedCommand[]): number {
  const times = commands.map((c) => c.ms).sort((a, b) => a - b);
  let peak = 0;
  let from = 0;
  for (let to = 0; to < times.length; to++) {
    while (times[to] - times[from] >= 1000) from++;
    peak = Math.max(peak, to - from + 1);
  }
  return peak;
}

export interface Latency { t0: number; ms: number }

/**
 * Commands that arrived set against the ones expected. Each LED is compared on its own: its codes in
 * the order they arrived against the order expected, matched by longest common subsequence. An
 * expected code left unmatched that arrived elsewhere on that LED counts as reordered, otherwise as
 * missing; an arrived code left unmatched after that is extra.
 */
export interface LedTimingResult {
  expected: number;
  arrived: number;
  matched: number;
  reordered: number;
  missing: number;
  extra: number;
  /** Matched commands that arrived after one expected more than OVERTAKE_MS later, on any LED. */
  overtaken: number;
  /** Arrival minus expected time of each matched command, in expected order. */
  latencies: Latency[];
  /** The first few LEDs whose order differs, for reproducing it. */
  differences: string[];
}

/** Two LedRunner ticks: closer than this, two commands can share a tick and leave in either order. */
export const OVERTAKE_MS = 8;
/** Larger differing middles use linear-memory LCS rather than allocating the full matrix. */
const MAX_DIFF_CELLS = 20_000_000;
const MAX_REPORTED_DIFFERENCES = 10;

export function compareLedCommands(expected: readonly LedCommand[], arrived: readonly LedCommand[]): LedTimingResult {
  const wantByLed = groupByLed(expected);
  const gotByLed = groupByLed(arrived);
  const result: LedTimingResult = {
    expected: expected.length, arrived: arrived.length,
    matched: 0, reordered: 0, missing: 0, extra: 0, overtaken: 0, latencies: [], differences: [],
  };
  const matchOf = new Map<LedCommand, LedCommand>();

  for (const key of new Set([...wantByLed.keys(), ...gotByLed.keys()])) {
    const want = wantByLed.get(key) ?? [];
    const got = gotByLed.get(key) ?? [];
    const pairs = commonSubsequence(want.map((c) => c.code), got.map((c) => c.code));
    result.matched += pairs.length;
    for (const [w, g] of pairs) {
      result.latencies.push({ t0: want[w].ms, ms: got[g].ms - want[w].ms });
      matchOf.set(got[g], want[w]);
    }
    if (pairs.length === want.length && pairs.length === got.length) continue;

    const matchedWant = new Set(pairs.map(([w]) => w));
    const matchedGot = new Set(pairs.map(([, g]) => g));
    const unmatchedGot = got.filter((_, g) => !matchedGot.has(g)).map((c) => c.code);
    want.forEach((command, w) => {
      if (matchedWant.has(w)) return;
      const at = unmatchedGot.indexOf(command.code);
      if (at >= 0) {
        unmatchedGot.splice(at, 1);
        result.reordered++;
      } else {
        result.missing++;
      }
    });
    result.extra += unmatchedGot.length;
    if (result.differences.length < MAX_REPORTED_DIFFERENCES) result.differences.push(describe(key, want, got));
  }

  let latestExpected = -Infinity;
  for (const command of arrived) {
    const t0 = matchOf.get(command)?.ms;
    if (t0 === undefined) continue;
    if (t0 + OVERTAKE_MS < latestExpected) result.overtaken++;
    latestExpected = Math.max(latestExpected, t0);
  }
  result.latencies.sort((a, b) => a.t0 - b.t0);
  return result;
}

/**
 * Index pairs of a longest common subsequence. The sequences are usually equal or nearly so, so the
 * shared head and tail are matched directly and only the part between them is compared cell by cell.
 */
function commonSubsequence(a: readonly number[], b: readonly number[]): [number, number][] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  if (n === 1 && m > 0) {
    const j = b.indexOf(a[head], head);
    if (j >= head && j < head + m) pairs.push([head, j]);
  } else if (n > 0 && m > 0 && n * m <= MAX_DIFF_CELLS) {
    const width = m + 1;
    const table = new Int32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = a[head + i] === b[head + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[head + i] === b[head + j]) {
        pairs.push([head + i, head + j]);
        i++;
        j++;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  } else if (n > 0 && m > 0) {
    // Hirschberg's split preserves an exact LCS for large inputs with linear working memory.
    const middle = head + Math.floor(n / 2);
    const left = a.slice(head, middle);
    const right = a.slice(middle, head + n);
    const other = b.slice(head, head + m);
    const forward = lcsLengths(left, other);
    const backward = lcsLengths([...right].reverse(), [...other].reverse());
    let split = 0;
    for (let j = 1; j <= m; j++) {
      if (forward[j] + backward[m - j] > forward[split] + backward[m - split]) split = j;
    }
    for (const [i, j] of commonSubsequence(left, other.slice(0, split))) pairs.push([head + i, head + j]);
    for (const [i, j] of commonSubsequence(right, other.slice(split))) pairs.push([middle + i, head + split + j]);
  }
  for (let k = 0; k < tail; k++) pairs.push([a.length - tail + k, b.length - tail + k]);
  return pairs;
}

/** LCS length against each prefix of b, keeping just one row. */
function lcsLengths(a: readonly number[], b: readonly number[]): Int32Array {
  const row = new Int32Array(b.length + 1);
  for (const code of a) {
    let diagonal = 0;
    for (let j = 0; j < b.length; j++) {
      const previous = row[j + 1];
      row[j + 1] = code === b[j] ? diagonal + 1 : Math.max(row[j], previous);
      diagonal = previous;
    }
  }
  return row;
}

function describe(key: string, want: readonly LedCommand[], got: readonly LedCommand[]): string {
  let first = 0;
  while (first < want.length && first < got.length && want[first].code === got[first].code) first++;
  const from = Math.max(0, first - 2);
  const window = (commands: readonly LedCommand[]) =>
    commands.slice(from, first + 4).map((c) => `${c.code}@${c.ms.toFixed(1)}`).join(', ');
  const [x, y] = key.split(',');
  const led = x === '-1' ? `round ${y}` : `pad ${x},${y}`;
  return `${led}: ${want.length} expected, ${got.length} arrived; from #${from} expected [${window(want)}] arrived [${window(got)}]`;
}

/** The nearest-rank `p`th percentile of ascending `sorted`. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export interface LatencySummary {
  median: number;
  p95: number;
  max: number;
  /** Least-squares slope of latency over expected time, in ms per minute of play: above 0 means it builds up. */
  buildUpPerMinute: number;
  /** Median latency of the commands expected in each tenth of the play time. */
  medianByTenth: number[];
}

export function summarizeLatency(latencies: readonly Latency[]): LatencySummary {
  const sorted = latencies.map((l) => l.ms).sort((a, b) => a - b);
  let buildUpPerMinute = 0;
  if (latencies.length >= 2) {
    const meanT = latencies.reduce((s, l) => s + l.t0, 0) / latencies.length;
    const meanL = latencies.reduce((s, l) => s + l.ms, 0) / latencies.length;
    let num = 0;
    let den = 0;
    for (const l of latencies) {
      num += (l.t0 - meanT) * (l.ms - meanL);
      den += (l.t0 - meanT) ** 2;
    }
    buildUpPerMinute = den === 0 ? 0 : (num / den) * 60_000;
  }
  const end = latencies.reduce((m, l) => Math.max(m, l.t0), 0) + 1;
  const medianByTenth = latencies.length === 0 ? [] : Array.from({ length: 10 }, (_, i) =>
    percentile(latencies.filter((l) => Math.floor((l.t0 * 10) / end) === i).map((l) => l.ms).sort((a, b) => a - b), 50));
  return { median: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted.at(-1) ?? NaN, buildUpPerMinute, medianByTenth };
}
