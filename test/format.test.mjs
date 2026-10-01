import test from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf } from '../plugin/src/host/project.js';
import { formatTokens, slashMenu } from '../app/src/format.js';

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

test('the "/" menu filters commands, then skills, by the typed prefix and shows the chosen hint', () => {
  const menu = {
    commands: [{ name: 'compact', description: '压缩上下文', hint: null }, { name: 'goal', description: '设置目标', hint: '<目标>' }],
    skills: [{ name: 'code-review', description: '代码评审' }, { name: 'commit', description: '提交' }],
  };
  assert.deepEqual(slashMenu(menu, '/').items.map((i) => `${i.kind}:${i.name}`), ['command:compact', 'command:goal', 'skill:code-review', 'skill:commit']);
  assert.deepEqual(slashMenu(menu, '/co').items.map((i) => i.name), ['compact', 'code-review', 'commit']);
  assert.deepEqual(slashMenu(menu, '/zz').items, []);
  assert.equal(slashMenu(menu, '/goal ').hint, '/goal <目标>');
  assert.equal(slashMenu(menu, '/compact ').hint, null);
  // No menu once arguments are typed, for ordinary text, or before the list has loaded.
  for (const text of ['/goal 跑测试', 'hello /co', '', 'co']) assert.deepEqual(slashMenu(menu, text), { items: [], hint: null }, text);
  assert.deepEqual(slashMenu(undefined, '/co'), { items: [], hint: null });
});
