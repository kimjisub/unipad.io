// Expectations for G6. expectedFailing names apps whose current behavior needs a correction;
// it is documentation, never an exception to the expected result or an assertion.
import { anim, cell, decision, ev, ledCell, lines, loaded, pack, q, refused, STD_INFO } from './lib.mjs';

const basis = (items, note) => [decision(`meta/unipack-conformance/GRAMMAR.md G6 ${items.join(', ')}`, note)];
export function g6Cases() {
  const cases = [];
  const add = (id, items, title, files, expected, expectedFailing = [], extra = {}) => cases.push({
    id, items, title, area: 'G6', layer: 'parse', expectation: 'determined', files, expected,
    basis: basis(items, title), expectedFailing, ...extra,
  });
  const sound = (name) => loaded({ sounds: [cell(0, 0, 0, [q(name)])] });
  for (const [id, written, stored] of [
    ['KS-G601', '소리.wav', '소리.wav'.normalize('NFD')],
    ['KS-G602', '소리.wav'.normalize('NFD'), '소리.wav'],
    ['KS-G603', 'café.wav', 'café.wav'.normalize('NFD')],
    ['KS-G604', 'CAFÉ.wav'.normalize('NFD'), 'café.wav'],
  ]) add(id, ['S-12'], 'composed and decomposed sound names resolve to the stored path',
    pack({ keySound: `1 1 1 ${written}`, sounds: [], extra: [{ path: `sounds/${stored}`, asset: 'tone-440' }] }), sound(stored), ['android', 'web']);

  for (const [id, key] of [['INF-G601', 'buttonX'], ['INF-G602', 'buttonY'], ['INF-G603', 'chain']]) {
    const value = key === 'buttonX' ? '4' : key === 'buttonY' ? '3' : '2';
    add(id, [key === 'chain' ? 'I-07' : 'I-04', 'T-09'], 'info sizes and chains require ASCII digits',
      pack({ info: STD_INFO.replace(`${key}=${value}`, `${key}=８`) }), refused(), ['android']);
  }
  for (const [id, keySound] of [
    ['KS-G605', '１ 1 1 a.wav'], ['KS-G606', '1 １ 1 a.wav'], ['KS-G607', '1 1 １ a.wav'],
    ['KS-G608', '1 1 1 a.wav １'], ['KS-G609', '1 1 1 a.wav 1 １'],
  ]) add(id, ['T-09', 'S-04'], 'non-ASCII keySound digits are a format error', pack({ keySound }), loaded({ errors: ['keySound:format'] }), ['android']);
  add('KL-G601', ['T-09', 'L-05'], 'non-ASCII digits in an LED file name are a format error',
    pack({ keySound: '', keyLed: { '１ 1 1': 'o 1 1 FF0000' } }), loaded({ keyLedExist: true, errors: ['keyLed:format'] }), ['android']);
  add('KL-G602', ['T-09', 'E-08'], 'non-ASCII delay digits are a format error',
    pack({ keySound: '', keyLed: { '1 1 1': 'd １００' } }), loaded({ keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [])])], errors: ['keyLed:format'] }), ['android']);
  add('KL-G603', ['E-02'], 'non-ASCII hex lookalikes are a format error',
    pack({ keySound: '', keyLed: { '1 1 1': 'o 1 1 ＦＦ0000' } }), loaded({ keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [])])], errors: ['keyLed:format'] }), ['android']);
  add('AP-G601', ['T-09', 'P-06'], 'non-ASCII autoPlay digits are a format error',
    pack({ keySound: '', autoPlay: 'd １００' }), loaded({ autoPlay: [], errors: ['autoPlay:format'] }), ['android']);

  add('KS-G610', ['S-06', 'S-07'], 'a written zero wormhole means no chain change and no warning',
    pack({ keySound: '1 1 1 a.wav 1 0' }), sound('a.wav'));
  add('KS-G611', ['S-06', 'S-07'], 'a negative wormhole still clamps to chain one and warns',
    pack({ keySound: '1 1 1 a.wav 1 -1' }), loaded({ sounds: [cell(0, 0, 0, [q('a.wav', 0, 0)])], errors: ['keySound:range'] }));
  for (const [id, key] of [['INF-G604', 'buttonX'], ['INF-G605', 'buttonY']]) add(id, ['I-04'],
    'a missing size key refuses the pack rather than making a grid with no pads',
    pack({ info: STD_INFO.split('\n').filter((line) => !line.startsWith(`${key}=`)).join('\n') }), refused(), ['android', 'ios', 'web']);

  for (const [id, written, stored] of [
    ['KS-G612', 'fx\\s.wav', 'fx/s.wav'], ['KS-G613', './a.wav', 'a.wav'],
    ['KS-G614', '/a.wav', 'a.wav'], ['KS-G615', 'fx//s.wav', 'fx/s.wav'], ['KS-G616', 'fx/./s.wav', 'fx/s.wav'],
  ]) add(id, ['S-11'], 'normalize a sound path relative to sounds before lookup',
    pack({ keySound: `1 1 1 ${written}`, sounds: [stored] }), sound(stored), id === 'KS-G612' ? ['android', 'ios', 'web'] : ['android', 'web']);
  const caseSensitive = 'this host cannot store names differing only in letter case; run on a case-sensitive filesystem before confirming this case';
  add('KS-G617', ['S-12'], 'case-insensitive candidates use UTF-16 full-path order, not archive order',
    pack({ keySound: '1 1 1 End.wav', sounds: [], extra: [{ path: 'sounds/end.wav', asset: 'tone-440' }, { path: 'sounds/END.wav', asset: 'tone-660' }] }),
    sound('END.wav'), ['web'], { requiresCaseSensitiveFiles: true, unobserved: { android: caseSensitive, ios: caseSensitive } });
  add('KS-G618', ['S-12'], 'case-insensitive lookup searches every full path instead of committing to one folder',
    pack({ keySound: '1 1 1 Fx/b.wav', sounds: [], extra: [{ path: 'sounds/FX/a.wav', asset: 'tone-440' }, { path: 'sounds/fx/b.wav', asset: 'tone-660' }] }),
    sound('fx/b.wav'), ['ios'], { requiresCaseSensitiveFiles: true, unobserved: { android: caseSensitive, ios: caseSensitive } });
  add('KS-G619', ['S-12'], 'an exact sound name wins over all case-insensitive candidates',
    pack({ keySound: '1 1 1 end.wav', sounds: [], extra: [{ path: 'sounds/END.wav', asset: 'tone-660' }, { path: 'sounds/end.wav', asset: 'tone-440' }] }),
    sound('end.wav'), [], { requiresCaseSensitiveFiles: true, unobserved: { android: caseSensitive, ios: caseSensitive } });
  add('KL-G604', ['E-02', 'E-03', 'E-04'], 'bare a is hex 00000A for pad, logo and round lights',
    pack({ keySound: '', keyLed: { '1 1 1': lines('o 1 1 a', 'o l a', 'o * 1 a') } }),
    loaded({ keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [ev.on(0, 0, 'ff00000a'), ev.on(-1, 32, 'ff00000a'), ev.on(-1, 0, 'ff00000a')])])] }));
  for (const [id, event] of [['KL-G605', 'o mc 99'], ['KL-G606', 'o * 0 FF0000 5 6']]) add(id, ['E-05', 'E-11'],
    'wrong column count warns before checking round-light range', pack({ keySound: '', keyLed: { '1 1 1': event } }),
    loaded({ keyLedExist: true, leds: [ledCell(0, 0, 0, [anim(1, [])])], errors: ['keyLed:format'] }), ['android', 'web']);

  const press = (x = 0, y = 0, input) => ({ do: 'press', x, y, ...(input && { input }) });
  const release = (x = 0, y = 0, input) => ({ do: 'release', x, y, ...(input && { input }) });
  const advance = (ms) => ({ do: 'advance', ms });
  const chain = (c) => ({ do: 'chain', c });
  const observe = { do: 'observe' };
  const watch = { do: 'watchStops' };
  const snd = (c, name = 'a.wav', loop = 0) => ['sound', c, 0, 0, name, loop];
  const stop = (c, name = 'a.wav') => ['soundStop', c, 0, 0, name];
  const on = ['ledOn', 0, 0, 'ffff0000', 4];
  const off = ['ledOff', 0, 0];
  const run = (id, items, title, files, scenario, checkpoints, expectedFailing = [], extra = {}) =>
    add(id, items, title, files, { checkpoints }, expectedFailing, { layer: 'run', scenario, ...extra });
  const endless = 'o 1 1 FF0000\nd 1000\nf 1 1';
  for (const [id, keySound, led, actions, before] of [
    ['RUN-G601', '', endless, [chain(1)], [on]],
    ['RUN-G602', '1 1 1 a.wav 1 2', endless, [advance(100)], [snd(0), on, ['chain', 1]]],
    ['RUN-G603', '', 'o 1 1 FF0000\nc 2\nd 1000\nf 1 1', [], [on, ['chain', 1]]],
  ]) run(id, ['RL-03'], 'release ends the original endless animation after a chain change',
    pack({ keySound, keyLed: { '1 1 1 0': led } }),
    [press(), advance(20), ...actions, observe, release(), advance(20), observe], [before, [off]], ['ios', 'web']);
  run('RUN-G604', ['RL-03', 'RA-02'], 'autoPlay release ends its endless animation after a scripted chain change',
    pack({ keySound: '', keyLed: { '1 1 1 0': endless }, autoPlay: 'on 1 1\nd 100\nc 2\noff 1 1\nd 1000' }),
    [{ do: 'autoplay', toPads: true }, advance(50), observe, advance(100), observe],
    [[['autoOn', 0, 0], on], [['autoChain', 1], ['autoOff', 0, 0], off]], ['ios', 'web']);
  run('RUN-G605', ['RA-04', 'RS-09'], 'autoPlay applies a wormhole immediately without a delayed second switch',
    pack({ info: STD_INFO.replace('chain=2', 'chain=3'), keySound: '1 1 1 a.wav 1 2', autoPlay: 'on 1 1\nd 50\nc 3\nd 200' }),
    [{ do: 'autoplay', toPads: true }, advance(20), observe, advance(40), observe, advance(100), observe],
    [[['autoOn', 0, 0], snd(0), ['autoChain', 1]], [['autoChain', 2]], []], ['android', 'ios', 'web']);
  run('RUN-G606', ['RS-09'], 'manual chain selection does not cancel a pending manual wormhole',
    pack({ info: STD_INFO.replace('chain=2', 'chain=3'), keySound: '1 1 1 a.wav 1 2' }),
    [press(), observe, advance(50), chain(2), observe, advance(60), observe],
    [[snd(0)], [], [['chain', 1]]], ['web'], { screenInputs: true });
  for (const [id, first, second] of [['RUN-G607', 'pointer:1', 'pointer:2'], ['RUN-G608', 'pointer:1', 'midi:1']])
    run(id, ['RS-05', 'RL-03'], 'the last player input release owns the current endless sound and light',
      pack({ keySound: '1 1 1 a.wav 0', keyLed: { '1 1 1 0': endless } }),
      [watch, press(0, 0, first), advance(20), observe, press(0, 0, second), advance(20), observe, release(0, 0, first), advance(20), observe, release(0, 0, second), advance(20), observe],
      [[snd(0, 'a.wav', -1), on], [stop(0), snd(0, 'a.wav', -1), off, on], [], [stop(0), off]], ['android', 'ios', 'web'], { screenInputs: true });
  for (const [id, first, second] of [['RUN-G617', 'pointer:1', 'pointer:2'], ['RUN-G618', 'pointer:1', 'midi:1']])
    run(id, ['RS-05', 'RL-03'], 'releasing the later player input first still waits for the last held input',
      pack({ keySound: '1 1 1 a.wav 0', keyLed: { '1 1 1 0': endless } }),
      [watch, press(0, 0, first), advance(20), observe, press(0, 0, second), advance(20), observe, release(0, 0, second), advance(20), observe, release(0, 0, first), advance(20), observe],
      [[snd(0, 'a.wav', -1), on], [stop(0), snd(0, 'a.wav', -1), off, on], [], [stop(0), off]], ['android', 'ios', 'web'], { screenInputs: true });
  run('RUN-G609', ['RS-05', 'RL-03', 'RA-02'], 'a manual release does not end the sound and light now owned by autoPlay',
    pack({ keySound: '1 1 1 a.wav 0', keyLed: { '1 1 1 0': endless }, autoPlay: 'd 300\non 1 1\nd 700\noff 1 1\nd 1000' }),
    [watch, press(), advance(20), observe, { do: 'autoplay', toPads: true }, advance(320), observe, release(), advance(20), observe, advance(700), observe],
    [[snd(0, 'a.wav', -1), on], [['autoOn', 0, 0], stop(0), snd(0, 'a.wav', -1), off, on], [], [['autoOff', 0, 0], stop(0), off]], ['android', 'ios', 'web'], { screenInputs: true });
  run('RUN-G610', ['RS-05', 'RL-03', 'RA-02'], 'an autoPlay release does not end the sound and light now owned by the player',
    pack({ keySound: '1 1 1 a.wav 0', keyLed: { '1 1 1 0': endless }, autoPlay: 'on 1 1\nd 300\noff 1 1\nd 1000' }),
    [watch, { do: 'autoplay', toPads: true }, advance(20), observe, press(), advance(20), observe, advance(300), observe, release(), advance(20), observe],
    [[['autoOn', 0, 0], snd(0, 'a.wav', -1), on], [stop(0), snd(0, 'a.wav', -1), off, on], [['autoOff', 0, 0]], [stop(0), off]], ['android', 'ios', 'web'], { screenInputs: true });
  run('RUN-G611', ['S-06', 'RS-09'], 'zero wormhole on chain two does not move to chain one',
    pack({ keySound: '2 1 1 a.wav 1 0' }), [chain(1), press(), advance(150), observe], [[snd(1)]]);
  run('RUN-G612', ['RS-07'], 'sounds at the same coordinates in different chains overlap',
    pack({ keySound: '1 1 1 a.wav 1 2\n2 1 1 b.wav' }),
    [watch, press(), advance(100), observe, press(), observe], [[snd(0), ['chain', 1]], [snd(1, 'b.wav')]]);
  run('RUN-G613', ['S-05', 'RS-04', 'RS-05'], 'a negative repeat plays once and release does not stop it',
    pack({ keySound: '1 1 1 a.wav -1' }), [watch, press(), observe, release(), observe], [[snd(0)], []]);
  run('RUN-G614', ['RA-04', 'RL-05'], 'autoPlay restores its parsed chain after an LED chain event before its next press',
    pack({ keySound: '', keyLed: { '1 1 1': 'c 2' }, autoPlay: 'on 1 1\nd 100\non 2 1\nd 1000' }),
    [{ do: 'autoplay', toPads: true }, advance(20), observe, advance(100), observe],
    [[['autoOn', 0, 0], ['chain', 1]], [['autoChain', 0], ['autoOn', 1, 0]]]);
  run('RUN-G615', ['RL-05'], 'LED chain events clamp destinations below and above the pack range',
    pack({ keySound: '', keyLed: { '1 1 1': 'c -1\nd 100\nc 99' } }),
    [press(), advance(20), observe, advance(100), observe], [[['chain', 0]], [['chain', 1]]]);
  run('RUN-G616', ['RA-04', 'RS-09'], 'stopping autoPlay cancels any delayed chain change from its sound',
    pack({ info: STD_INFO.replace('chain=2', 'chain=3'), keySound: '1 1 1 a.wav 1 2', autoPlay: 'on 1 1\nd 1000' }),
    [{ do: 'autoplay', toPads: true }, advance(20), observe, { do: 'autoplayOff' }, advance(150), observe],
    [[['autoOn', 0, 0], snd(0), ['autoChain', 1]], []], ['android', 'ios', 'web'], { screenInputs: true });
  return cases;
}
