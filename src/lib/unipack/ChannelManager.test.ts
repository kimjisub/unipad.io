import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Channel, ChannelManager } from './ChannelManager';

test('chain and pressed channels retain their shared priority and public numeric value', () => {
  assert.equal(Channel.PRESSED, 3);
  assert.equal(Channel.CHAIN, Channel.PRESSED);
  assert.equal(Channel[3], 'CHAIN');
  const channels = new ChannelManager(1, 1);
  for (const [x, y] of [[0, 0], [-1, 0]]) {
    channels.add(x, y, Channel.LED, 0x123456, 1);
    channels.add(x, y, Channel.CHAIN, 0xabcdef, 3);
    assert.equal(channels.get(x, y)?.channel, Channel.CHAIN);
    channels.remove(x, y, Channel.PRESSED);
    assert.equal(channels.get(x, y)?.channel, Channel.LED);
  }
});
