export const NO_WORMHOLE = -1;

export interface Sound {
  file: string;
  audioBuffer: AudioBuffer | null;
  loop: number;
  wormhole: number;
  num: number;
}

export interface LedEventOn {
  type: 'on';
  x: number;
  y: number;
  color: number;
  velocity: number;
}

export interface LedEventOff {
  type: 'off';
  x: number;
  y: number;
}

export interface LedEventDelay {
  type: 'delay';
  delay: number;
}

export interface LedEventChain {
  type: 'chain';
  chain: number;
}

export type LedEvent = LedEventOn | LedEventOff | LedEventDelay | LedEventChain;

export interface LedAnimation {
  ledEvents: LedEvent[];
  loop: number;
  num: number;
}

export interface AutoPlayElementOn {
  type: 'on';
  x: number;
  y: number;
  currChain: number;
  num: number;
}

export interface AutoPlayElementOff {
  type: 'off';
  x: number;
  y: number;
  currChain: number;
}

export interface AutoPlayElementChain {
  type: 'chain';
  c: number;
}

export interface AutoPlayElementDelay {
  type: 'delay';
  delay: number;
}

export type AutoPlayElement =
  | AutoPlayElementOn
  | AutoPlayElementOff
  | AutoPlayElementChain
  | AutoPlayElementDelay;

export interface AutoPlay {
  elements: AutoPlayElement[];
}

export interface UniPackInfo {
  title: string;
  producerName: string;
  buttonX: number;
  buttonY: number;
  chain: number;
  squareButton: boolean;
  website: string | null;
}

export interface UniPackData {
  info: UniPackInfo;
  soundTable: (Sound[] | null)[][][];
  ledAnimationTable: (LedAnimation[] | null)[][][] | null;
  autoPlay: AutoPlay | null;
  soundFiles: Map<string, ArrayBuffer>;
  keyLedExist: boolean;
  autoPlayExist: boolean;
  errors: string[];
}
