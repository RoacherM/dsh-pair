/** Pure helpers for the PWA, kept out of main.js so Node tests can import them. */

/** Compact token count as DSH shows it: 517 / 12.2K / 517K / 1.2M. */
export function formatTokens(value) {
  const scaled = (n) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  if (value < 1e3) return String(value);
  if (value < 1e6) return `${scaled(value / 1e3)}K`;
  return `${scaled(value / 1e6)}M`;
}

const MENU_SIZE = 8;

/**
 * The composer's `/` menu for `text`. While a leading `/name` is being typed: the commands, then
 * skills, whose names start with it. Once `/name ` is typed: that command's input hint, if any.
 * @param menu - `commands.list` result: { commands: [{name, description, hint}], skills: [{name, description}] }.
 */
export function slashMenu(menu, text) {
  const typing = /^\/([a-z0-9_-]*)$/.exec(text);
  if (typing) {
    const pick = (list, kind) => (list ?? []).filter((x) => x.name.startsWith(typing[1]))
      .map((x) => ({ kind, name: x.name, description: x.description ?? '', hint: x.hint ?? null }));
    return { items: [...pick(menu?.commands, 'command'), ...pick(menu?.skills, 'skill')].slice(0, MENU_SIZE), hint: null };
  }
  const chosen = /^\/([a-z0-9_-]+) $/.exec(text);
  const command = chosen && menu?.commands?.find((c) => c.name === chosen[1]);
  return { items: [], hint: command?.hint ? `/${command.name} ${command.hint}` : null };
}
