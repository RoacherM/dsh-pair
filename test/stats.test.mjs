import test from 'node:test';
import assert from 'node:assert/strict';
import { queueOf, statsOf } from '../plugin/src/host/project.js';

test('stats come from DSH projections the way its composer shows them', () => {
  const stats = statsOf({
    sessionStats: { turns: 12, steps: 48, decodeMs: 4000, decodeTokens: 208 },
    tokenUsage: { uncachedInputTokens: 6000, cacheReadTokens: 93000, cacheWriteTokens: 1000, outputTokens: 5 },
    contextPressure: { contextWindow: 200000, pressureTokens: 80000, projectedTokens: 82000 },
  });
  assert.deepEqual(stats, { turns: 12, steps: 48, tps: 52, cacheHit: 93, context: 41 });
  // A near-full hit is never shown as 100; a full one is.
  assert.equal(statsOf({ tokenUsage: { uncachedInputTokens: 1, cacheReadTokens: 999, cacheWriteTokens: 0 } }).cacheHit, 99);
  assert.equal(statsOf({ tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 10, cacheWriteTokens: 0 } }).cacheHit, 100);
  // Without a projected value the sampled pressure is used; unknown numbers stay null.
  assert.equal(statsOf({ contextPressure: { contextWindow: 1000, pressureTokens: 250 } }).context, 25);
  assert.deepEqual(statsOf({}), { turns: null, steps: null, tps: null, cacheHit: null, context: null });
});

test('the queue lists the user messages waiting in the inbox', () => {
  const user = (id, content) => ({ id, role: 'user', content, source: { kind: 'user' } });
  const queue = queueOf({
    'next-turn': [user('a', [{ type: 'text', text: '顺便看看 README' }]), user('b', [{ type: 'image', attachment: {} }]),
      { id: 'c', role: 'user', content: [{ type: 'text', text: 'from a subagent' }], source: { kind: 'agent-message' } }],
    'next-step': [user('d', [{ type: 'text', text: '先别改测试' }])],
  });
  assert.deepEqual(queue, [
    { id: 'a', target: 'next-turn', text: '顺便看看 README', images: 0 },
    { id: 'b', target: 'next-turn', text: '', images: 1 },
    { id: 'd', target: 'next-step', text: '先别改测试', images: 0 },
  ]);
  assert.deepEqual(queueOf(undefined), []);
});
