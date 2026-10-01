import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommands } from '../plugin/src/host/commands.js';
import { projectEvent } from '../plugin/src/host/project.js';

const REGISTERED = ['compact', 'danger-full-access', 'export', 'goal', 'plan', 'workspace-write'];

/** A DSH ctx with a command registry, the agent lookup and a skill catalog; records what ran. */
function fakeCtx({ withCommands = true, withTypert = true } = {}) {
  const agent = { id: 'S1' };
  const ran = [];
  const resolved = [];
  const services = {
    commands: withCommands ? {
      list: (a) => (a === agent ? REGISTERED.map((name) => ({ name, description: `${name} 说明`, ...(name === 'goal' ? { input: { hint: '<目标>' } } : {}) })) : []),
      find: (a, name) => (a === agent && REGISTERED.includes(name) ? { name } : undefined),
      execute: async (a, line, attachments, signal) => {
        assert.equal(a, agent);
        assert.ok(signal instanceof AbortSignal);
        ran.push({ line, attachments });
        return { commandId: 'cmd-1', result: line.startsWith('/goal') && !line.slice(5).trim() ? { kind: 'error', text: '需要目标' } : { kind: 'success', text: 'ok' } };
      },
    } : undefined,
    typert: withTypert ? { lookups: { get: (key) => (key === 'agent' ? { resolve: async (id) => { resolved.push(id); return id === 'S1' ? agent : undefined; } } : undefined) } } : undefined,
    sessionSkillCatalog: { list: async ({ sessionId }) => ({ skills: sessionId === 'S1' ? [{ name: 'review', description: '代码评审' }] : [] }) },
  };
  return { ctx: { get: (name) => services[name] }, ran, resolved };
}

test('an allowed command runs through ctx.commands against the session agent, not as a prompt', async () => {
  const { ctx, ran, resolved } = fakeCtx();
  const commands = createCommands({ ctx });
  assert.deepEqual(await commands.run('S1', '/compact', false), { kind: 'success', text: 'ok' });
  assert.deepEqual(await commands.run('S1', '/goal 把测试跑绿', false), { kind: 'success', text: 'ok' });
  assert.deepEqual(await commands.run('S1', '/goal', false), { kind: 'error', text: '需要目标' });
  assert.deepEqual(ran.map((r) => r.line), ['/compact', '/goal 把测试跑绿', '/goal']);
  assert.ok(ran.every((r) => r.attachments.length === 0));
  assert.deepEqual(resolved, ['S1', 'S1', 'S1']);
});

test('commands outside phoneCommands are refused on the desktop and never run', async () => {
  const { ctx, ran } = fakeCtx();
  const commands = createCommands({ ctx });
  await assert.rejects(commands.run('S1', '/danger-full-access', false), /不能从手机运行/);
  await assert.rejects(commands.run('S1', '/workspace-write', false), /不能从手机运行/);
  assert.equal(ran.length, 0);
  // The allowlist is configurable, and an empty one refuses everything.
  const open = createCommands({ ctx, config: { phoneCommands: ['workspace-write'] } });
  assert.equal((await open.run('S1', '/workspace-write', false)).kind, 'success');
  await assert.rejects(open.run('S1', '/compact', false), /不能从手机运行/);
  await assert.rejects(createCommands({ ctx, config: { phoneCommands: [] } }).run('S1', '/plan', false), /不能从手机运行/);
});

test('a command with images is refused before it runs', async () => {
  const { ctx, ran } = fakeCtx();
  await assert.rejects(createCommands({ ctx }).run('S1', '/compact', true), /不接受图片/);
  assert.equal(ran.length, 0);
});

test('anything that is not a registered command stays a prompt', async () => {
  const { ctx, ran } = fakeCtx();
  const commands = createCommands({ ctx });
  for (const text of ['/review 看看这个改动', '/unknown', '帮我 /compact 一下', '/Compact', '//compact', '/compact!', 'hello']) {
    assert.equal(await commands.run('S1', text, false), undefined, text);
  }
  assert.equal(ran.length, 0);
  // Without DSH's command registry or agent lookup, slash lines are prompts too.
  assert.equal(await createCommands({ ctx: fakeCtx({ withCommands: false }).ctx }).run('S1', '/compact', false), undefined);
  assert.equal(await createCommands({ ctx: fakeCtx({ withTypert: false }).ctx }).run('S1', '/compact', false), undefined);
  assert.equal(await createCommands({ ctx: {} }).run('S1', '/compact', false), undefined);
});

test('the phone menu lists only allowed commands, plus the session skills', async () => {
  const { ctx } = fakeCtx();
  const menu = await createCommands({ ctx }).list('S1');
  assert.deepEqual(menu.commands.map((c) => c.name), ['compact', 'export', 'goal', 'plan']);
  assert.deepEqual(menu.commands.find((c) => c.name === 'goal'), { name: 'goal', description: 'goal 说明', hint: '<目标>' });
  assert.deepEqual(menu.skills, [{ name: 'review', description: '代码评审' }]);
  assert.deepEqual(await createCommands({ ctx: {} }).list('S1'), { commands: [], skills: [] });
});

test('command runs project to phone items', () => {
  assert.deepEqual(projectEvent({ type: 'command/run', seq: 7, time: 1, data: { commandId: 'c1', name: 'goal', args: ' 跑绿测试', source: { kind: 'user' } } }),
    { k: 'command', seq: 7, time: 1, commandId: 'c1', name: 'goal', args: '跑绿测试' });
  assert.deepEqual(projectEvent({ type: 'command/run', seq: 8, time: 1, data: { commandId: 'c2', name: 'compact' } }),
    { k: 'command', seq: 8, time: 1, commandId: 'c2', name: 'compact', args: '' });
  assert.deepEqual(projectEvent({ type: 'command/done', seq: 9, data: { commandId: 'c1', kind: 'success', text: '已设置目标' } }),
    { k: 'command-done', seq: 9, commandId: 'c1', error: false, text: '已设置目标' });
  assert.equal(projectEvent({ type: 'command/done', seq: 10, data: { commandId: 'c2', kind: 'error', text: '失败' } }).error, true);
});
