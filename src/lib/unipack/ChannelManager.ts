import { LAUNCHPAD_ARGB } from './colors';

export enum Channel {
  UI = 0,
  UI_UNIPAD = 1,
  GUIDE = 2,
  PRESSED = 3,
  CHAIN = 3,
  LED = 4,
}

const CHANNEL_COUNT = 5;
const CIRCULAR_BUTTON_COUNT = 36;

export interface ChannelItem {
  channel: Channel;
  color: number;
  code: number;
}

export class ChannelManager {
  private btn: (ChannelItem | null)[][][];
  private cir: (ChannelItem | null)[][];
  private btnIgnoreList: boolean[];
  private cirIgnoreList: boolean[];

  constructor(x: number, y: number) {
    this.btn = Array.from({ length: x }, () =>
      Array.from({ length: y }, () =>
        Array.from({ length: CHANNEL_COUNT }, () => null),
      ),
    );
    this.cir = Array.from({ length: CIRCULAR_BUTTON_COUNT }, () =>
      Array.from({ length: CHANNEL_COUNT }, () => null),
    );
    this.btnIgnoreList = Array.from({ length: CHANNEL_COUNT }, () => false);
    this.cirIgnoreList = Array.from({ length: CHANNEL_COUNT }, () => false);
  }

  get(x: number, y: number): ChannelItem | null {
    if (x !== -1) {
      for (let i = 0; i < CHANNEL_COUNT; i++) {
        if (this.btnIgnoreList[i]) continue;
        if (this.btn[x]?.[y]?.[i]) return this.btn[x][y][i];
      }
    } else {
      for (let i = 0; i < CHANNEL_COUNT; i++) {
        if (this.cirIgnoreList[i]) continue;
        if (this.cir[y]?.[i]) return this.cir[y][i];
      }
    }
    return null;
  }

  add(x: number, y: number, channel: Channel, color: number, code: number): void {
    const resolvedColor = color === -1 ? (LAUNCHPAD_ARGB[code] ?? 0) : color;
    const priority = this.channelPriority(channel);
    if (x !== -1) {
      if (this.btn[x]?.[y]) {
        this.btn[x][y][priority] = { channel, color: resolvedColor, code };
      }
    } else {
      if (this.cir[y]) {
        this.cir[y][priority] = { channel, color: resolvedColor, code };
      }
    }
  }

  remove(x: number, y: number, channel: Channel): void {
    const priority = this.channelPriority(channel);
    if (x !== -1) {
      if (this.btn[x]?.[y]) this.btn[x][y][priority] = null;
    } else {
      if (this.cir[y]) this.cir[y][priority] = null;
    }
  }

  setBtnIgnore(channel: Channel, ignore: boolean): void {
    this.btnIgnoreList[this.channelPriority(channel)] = ignore;
  }

  setCirIgnore(channel: Channel, ignore: boolean): void {
    this.cirIgnoreList[this.channelPriority(channel)] = ignore;
  }

  private channelPriority(channel: Channel): number {
    switch (channel) {
      case Channel.UI: return 0;
      case Channel.UI_UNIPAD: return 1;
      case Channel.GUIDE: return 2;
      case Channel.PRESSED:
      case Channel.CHAIN: return 3;
      case Channel.LED: return 4;
      default: return 0;
    }
  }
}
