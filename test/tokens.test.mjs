import test from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf } from '../plugin/src/host/project.js';
import { formatTokens } from '../app/src/format.js';

test('tokens used = billed prompt input plus output, as DSH counts them', () => {
  assert.equal(tokensOf({ tokenUsage: { uncachedInputTokens: 6000, cacheReadTokens: 93000, cacheWriteTokens: 1000, outputTokens: 5 } }), 100005);
  assert.equal(tokensOf({ tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } }), null);
  assert.equal(tokensOf({}), null);
  assert.equal(tokensOf(), null);
});

test('token counts are formatted like DSH: 517 / 12.2K / 517K / 1.2M', () => {
  assert.equal(formatTokens(517), '517');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1K');
  assert.equal(formatTokens(12_345), '12.3K');
  assert.equal(formatTokens(517_000), '517K');
  assert.equal(formatTokens(1_234_567), '1.2M');
  assert.equal(formatTokens(250_000_000), '250M');
});
