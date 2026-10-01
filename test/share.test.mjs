import test from 'node:test';
import assert from 'node:assert/strict';
import { createAway } from '../plugin/src/host/away.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

/**
 * Away mode off with one paired phone. `desktop` stands for DSH's own prompt, the rest of the
 * waterfall: it records the request it was shown and settles when the test says so.
 */
function setup({ devices = 1, config = {} } = {}) {
  const listeners = new Map();
  const pushes = [];
  const state = { away: { on: false, restore: {} }, devices: () => Array.from({ length: devices }), async setAway(v) { state.away = v; } };
  const ctx = {
    on(name, fn) { listeners.set(name, fn); },
    effect() {},
    permissionPresets: { current: () => 'danger-full-access', set() {}, resolve: () => ({}) },
    agents: { roots: () => [], list: () => [], get: () => undefined },
  };
  const away = createAway({ ctx, state, config, notify: async (p) => { pushes.push(p); }, titleOf: async () => '修 parser' });
  const desktop = { seen: null, settle: null, fail: null };
  const ask = (event, req) => listeners.get(event).call({}, req, () => new Promise((resolve, reject) => {
    desktop.seen = req;
    desktop.settle = resolve;
    desktop.fail = reject;
  }));
  return { away, state, pushes, desktop, ask };
}

const approval = (signal) => ({ agent: { session: { id: 's1' } }, toolName: 'bash', reason: 'npm test', ...(signal ? { signal } : {}) });
const question = (signal) => ({ agent: { session: { id: 's1' } }, callId: 'c9', questions: [{ id: 'q1', question: '用哪个方案？', options: [{ label: 'A' }, { label: 'B' }] }], ...(signal ? { signal } : {}) });

test('away off: an approval reaches both the desktop and the phone, and the desktop can answer it', async () => {
  const { away, pushes, desktop, ask } = setup();
  const decision = ask('approval/request', approval());
  await tick();
  assert.ok(desktop.seen, 'DSH still shows its own prompt');
  assert.equal(away.pending().length, 1);
  assert.equal(away.pending()[0].shared, true);
  desktop.settle('rejected');
  assert.equal(await decision, 'rejected');
  assert.equal(away.pending().length, 0, 'the phone card goes away');
  await tick();
  assert.equal(pushes.length, 0, 'no push while the desktop can answer');
});

test('away off: the phone answers first, and the desktop prompt is closed', async () => {
  const { away, desktop, ask } = setup();
  const turn = new AbortController();
  const decision = ask('approval/request', approval(turn.signal));
  await tick();
  const shown = desktop.seen.signal;
  assert.equal(shown.aborted, false);
  away.answer(away.pending()[0].id, { decision: 'allow' });
  assert.equal(await decision, 'allowed-once');
  assert.equal(shown.aborted, true, 'the signal DSH watches aborts, so its prompt closes');
  desktop.settle('cancelled'); // the closed prompt settling later changes nothing
  assert.equal(await decision, 'allowed-once');
  assert.equal(turn.signal.aborted, false, "the turn's own signal is untouched");
  assert.throws(() => away.answer('nope', {}), /已经处理过/);
});

test('away off: questions with options can be answered from the phone', async () => {
  const { away, desktop, ask } = setup();
  const answer = ask('user-questions/request', question());
  await tick();
  const item = away.pending()[0];
  assert.deepEqual(item.questions[0].options.map((o) => o.label), ['A', 'B']);
  away.answer(item.id, { answers: [{ id: 'q1', selected: ['B'] }] });
  assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['B'] }] });
  assert.equal(desktop.seen.signal.aborted, true);
});

test('when DSH cannot show the prompt, only the phone can answer: it is pushed and waits', async () => {
  const { away, pushes, desktop, ask } = setup();
  const decision = ask('approval/request', approval());
  await tick();
  desktop.settle('unavailable'); // no DSH window connected
  await tick();
  assert.equal(away.pending().length, 1, 'still waiting for the phone');
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].title, /需要审批 · 修 parser/);
  away.answer(away.pending()[0].id, { decision: 'allow' });
  assert.equal(await decision, 'allowed-once');

  const answer = ask('user-questions/request', question());
  await tick();
  desktop.fail(Object.assign(new Error('no user-questions answerer accepted the request'), { code: 'NO_PROVIDER' }));
  await tick();
  assert.equal(pushes.length, 2);
  assert.match(pushes[1].title, /需要回答/);
  away.answer(away.pending()[0].id, { answers: [{ id: 'q1', selected: ['A'] }] });
  assert.deepEqual(await answer, { answers: [{ id: 'q1', selected: ['A'] }] });
});

test('a desktop error other than "no prompt" still ends the request', async () => {
  const { away, desktop, ask } = setup();
  const answer = ask('user-questions/request', question());
  await tick();
  desktop.fail(Object.assign(new Error('bad'), { code: 'BAD_INTENT' }));
  await assert.rejects(answer, /bad/);
  assert.equal(away.pending().length, 0);
});

test('a cancelled turn takes the request off the phone', async () => {
  const { away, ask } = setup();
  const turn = new AbortController();
  const decision = ask('approval/request', approval(turn.signal));
  await tick();
  turn.abort();
  assert.equal(await decision, 'cancelled');
  assert.equal(away.pending().length, 0);
});

test('without a paired phone, or with answerOnPhone off, requests pass straight to DSH', async () => {
  for (const options of [{ devices: 0 }, { config: { answerOnPhone: false } }]) {
    const { away, desktop, ask } = setup(options);
    const decision = ask('approval/request', approval());
    await tick();
    assert.equal(away.pending().length, 0);
    desktop.settle('allowed-once');
    assert.equal(await decision, 'allowed-once');
  }
});

test('switching away mode on and off leaves shared requests on the phone', async () => {
  const { away, desktop, ask } = setup();
  const decision = ask('approval/request', approval());
  await tick();
  await away.set(true);
  await away.set(false);
  assert.equal(away.pending().length, 1);
  desktop.settle('allowed-once');
  assert.equal(await decision, 'allowed-once');
});
