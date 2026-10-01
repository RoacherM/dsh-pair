/**
 * Slash commands from a phone, run through DSH's command registry (`ctx.commands`) the way its own
 * composer runs them: directly against the session's agent, never as a model message. DSH logs
 * each run as `command/run` + `command/done`, which project.js turns into phone items.
 *
 * Only commands named in `phoneCommands` may run from a phone; the check is here on the desktop,
 * not in the phone's menu. A line that names no registered command (e.g. `/skill-name …`, which
 * DSH expands itself) stays an ordinary prompt, as it does when DSH has no command registry.
 */
export const DEFAULT_PHONE_COMMANDS = ['compact', 'goal', 'plan', 'export'];

const COMMAND_LINE = /^\/([a-z0-9_-]+)(?:\s|$)/;
const RUN_TIMEOUT_MS = 120_000;

export function createCommands({ ctx, config = {} }) {
  const allowed = new Set(config.phoneCommands ?? DEFAULT_PHONE_COMMANDS);
  const registry = () => ctx.get?.('commands');

  /** The live agent of a session — resumed if needed, as DSH's Web wire does it. */
  async function agentOf(sessionId) {
    const lookup = ctx.get?.('typert')?.lookups?.get('agent');
    return lookup ? lookup.resolve(sessionId) : undefined;
  }

  /**
   * Run `text` as a command when it names one.
   * @returns the command's result `{kind, text?}`, or undefined when `text` is a prompt.
   * @throws when the command may not run from a phone or cannot take images.
   */
  async function run(sessionId, text, hasImages) {
    const name = COMMAND_LINE.exec(text)?.[1];
    const commands = name && registry();
    if (!commands) return undefined;
    const agent = await agentOf(sessionId);
    if (!agent || !commands.find(agent, name)) return undefined;
    if (!allowed.has(name)) throw new Error(`/${name} 不能从手机运行（可在插件配置 phoneCommands 里允许）`);
    if (hasImages) throw new Error(`/${name} 不接受图片，请去掉图片再发`);
    const execution = await commands.execute(agent, text, [], AbortSignal.timeout(RUN_TIMEOUT_MS));
    if (!execution) return undefined;
    return { kind: execution.result.kind, ...(execution.result.text !== undefined ? { text: execution.result.text } : {}) };
  }

  /** The phone's `/` menu: allowed commands, then the session's user-invocable skills. */
  async function list(sessionId) {
    const commands = registry();
    const agent = commands ? await agentOf(sessionId) : undefined;
    const descriptors = agent ? commands.list(agent) : [];
    let skills = [];
    try {
      const catalog = await ctx.get?.('sessionSkillCatalog')?.list({ sessionId }, AbortSignal.timeout(10_000));
      skills = catalog?.skills ?? [];
    } catch {} // a menu without skills is still a menu
    return {
      commands: descriptors.filter((c) => allowed.has(c.name)).map((c) => ({ name: c.name, description: c.description, hint: c.input?.hint ?? null })),
      skills: skills.map((s) => ({ name: s.name, description: s.description ?? '' })),
    };
  }

  return { run, list };
}
