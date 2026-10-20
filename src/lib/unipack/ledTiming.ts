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
}

export interface IntendedTimeline {
  commands: LedCommand[];
  /** When autoplay plays its last element and ends: the sum of the delays before that element. */
  autoPlayLengthMs: number;
  /** Endless animations with no delay in a pass; LedRunner plays them a pass per tick, which no timeline can state. */
  delaylessEndlessAnimations: number;
  /** Endless animations still running on another chain at autoplay end; truncated there. */
  unreleasedEndlessAnimations: number;
  /** Chain changes inside LED animations, which this timeline does not follow. */
  ledChainEvents: number;
}

/** A timer stall can invalidate order and completeness when it exceeds the fixture's smallest
 * animation-to-next-press or animation-to-final-redraw gap. Extras remain unconditional failures. */
export function denseTimingVerdict(
  result: Pick<LedTimingResult, 'reordered' | 'missing' | 'extra'>,
  timerSpanMs: number,
  slackMs: number,
): 'pass' | 'fail' | 'inconclusive' {
  if (result.extra > 0) return 'fail';
  const differs = result.reordered > 0 || result.missing > 0;
  if (differs && timerSpanMs > slackMs) return 'inconclusive';
  return differs ? 'fail' : 'pass';
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

/** MIDIOutput data bytes, as MidiConnection clamps a code before sending it. */
const sentCode = (code: number) => Math.max(0, Math.min(127, Math.trunc(Number.isFinite(code) ? code : 0)));

/**
 * The LED commands the play screen sends when autoplay plays `pack` with no lag: each autoplay element
 * at the sum of the delays before it, and each keyLED event at its press time plus the delays before it
 * in the animation. Animations follow LedRunner: an LED belongs to the pad and chain whose animation lit
 * it last and only that owner's off turns it off; a press ends the running animation of the same pad
 * and chain and turns off every LED it owns; a release ends only endless (loop 0) animations. The play
 * screen redraws every pad twice as autoplay starts (switching the mode, then autoplay's first tick
 * clearing the guide) and twice as it ends (ledInit, then clearing the guide), which with nothing else
 * lit sends 0 to each; the end first releases every pad, as padInit does. Events due in the same
 * millisecond play animations in press order, then autoplay.
 */
export function intendedTimeline(pack: UniPackData): IntendedTimeline {
  return new TimelineSimulation(pack).run();
}

interface Owner { x: number; y: number; chain: number }

interface Animation {
  owner: Owner;
  led: LedAnimation;
  due: number;
  index: number;
  loopProgress: number;
  playing: boolean;
}

const sameOwner = (a: Owner | null | undefined, b: Owner) => !!a && a.x === b.x && a.y === b.y && a.chain === b.chain;

class TimelineSimulation {
  private readonly buttonX: number;
  private readonly buttonY: number;
  private readonly chainCount: number;
  /** The pack's multi-mapping queues, copied so that rotating them leaves the pack as it was. */
  private readonly table: (LedAnimation[] | null)[][][] | null;
  private readonly pads: (Owner | null)[][];
  private readonly rounds = new Map<number, Owner>();
  private running: Animation[] = [];
  private readonly out: LedCommand[] = [];
  private delayless = 0;
  private chain = 0;

  constructor(private readonly pack: UniPackData) {
    ({ buttonX: this.buttonX, buttonY: this.buttonY, chain: this.chainCount } = pack.info);
    this.table = pack.ledAnimationTable?.map((xs) => xs.map((ys) => ys.map((anims) => anims && [...anims]))) ?? null;
    this.pads = Array.from({ length: this.buttonX }, () => Array.from({ length: this.buttonY }, () => null));
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
          this.repaintPads(t);
          // A release only reaches the current chain. Endless animations on earlier chains have no
          // finite tail: stop modelling them here without inventing off commands the player never sent.
          unreleasedEndlessAnimations = this.running.filter((a) => a.playing && a.led.loop === 0).length;
          this.running = this.running.filter((a) => a.led.loop !== 0);
          ended = true;
        }
      }
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
    this.end(t, (a) => sameOwner(a.owner, owner));
    const anims = this.queue(x, y);
    const led = anims?.[0];
    if (anims && anims.length > 1) anims.push(anims.shift()!);
    if (led) this.running.push({ owner, led, due: t, index: 0, loopProgress: 0, playing: true });
  }

  private release(x: number, y: number, t: number): void {
    const owner = { x, y, chain: this.chain };
    this.end(t, (a) => sameOwner(a.owner, owner) && a.led.loop === 0);
  }

  private end(t: number, which: (a: Animation) => boolean): void {
    const ended = this.running.filter(which);
    for (const animation of ended) {
      for (let x = 0; x < this.buttonX; x++) {
        for (let y = 0; y < this.buttonY; y++) {
          if (sameOwner(this.pads[x][y], animation.owner)) {
            this.out.push({ ms: t, x, y, code: 0 });
            this.pads[x][y] = null;
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

  /** Every pad redrawn from its channels with no LED channel left, as ledInit does; owners stay. */
  private repaintPads(t: number): void {
    for (let x = 0; x < this.buttonX; x++) for (let y = 0; y < this.buttonY; y++) this.out.push({ ms: t, x, y, code: 0 });
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
      if (event.type === 'on') this.light(event.x, event.y, event.velocity, animation.owner, t);
      else if (event.type === 'off') this.dim(event.x, event.y, animation.owner, t);
      else if (event.type === 'delay') animation.due += event.delay;
      animation.index++;
    }
  }

  private light(x: number, y: number, velocity: number, owner: Owner, t: number): void {
    if (x === -1) {
      this.rounds.set(y, owner);
    } else {
      if (this.pads[x]?.[y] === undefined) return;
      this.pads[x][y] = owner;
    }
    this.out.push({ ms: t, x, y, code: sentCode(velocity) });
  }

  private dim(x: number, y: number, owner: Owner, t: number): void {
    if (x === -1) {
      if (!sameOwner(this.rounds.get(y), owner)) return;
      this.rounds.delete(y);
    } else {
      if (!sameOwner(this.pads[x]?.[y], owner)) return;
      this.pads[x][y] = null;
    }
    this.out.push({ ms: t, x, y, code: 0 });
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
  const group = (commands: readonly LedCommand[]) => {
    const byLed = new Map<string, LedCommand[]>();
    for (const command of commands) {
      const key = targetKey(command);
      let list = byLed.get(key);
      if (!list) byLed.set(key, list = []);
      list.push(command);
    }
    return byLed;
  };
  const wantByLed = group(expected);
  const gotByLed = group(arrived);
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
