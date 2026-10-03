/**
 * Developer mode: the switch that opens every gate at once.
 *
 * It is a URL PARAMETER and nothing else -- `?dev=1` -- because that is the one
 * place a mode can live without becoming a lie. A stored flag survives a reload
 * nobody was thinking about, and a hidden flag that quietly unlocks the game
 * makes a developer report "progress is broken" about a session they turned into
 * a sandbox an hour earlier. The URL is visible, copyable, and gone the moment
 * the tab is.
 *
 * WHAT IT OPENS is exactly two gates, both in `app/progress.ts`: every level
 * becomes reachable from the chapter map, and every component a level lists is
 * offered by its palette. Without the second one the first is useless -- opening
 * level 47 with a starter palette leaves nothing to build it out of -- which is
 * why the flag travels to both and is tested at both.
 *
 * WHAT IT DOES NOT DO: it never writes progress. Levels opened this way are not
 * passed, no stars are awarded, and a save is not touched. That is what keeps it
 * a debugging tool rather than a cheat code, and it is why turning it off leaves
 * the game exactly where it was.
 */

/**
 * Whether the given `location.search` asks for developer mode.
 *
 * `?dev`, `?dev=1` and `?dev=anything` turn it on; `?dev=0` and `?dev=false`
 * turn it off, so a URL can carry the switch in either position -- a link that
 * says "not in dev mode" is as useful as one that says it is, and neither needs
 * the reader to know that absence means off.
 */
export function devModeFrom(search: string): boolean {
  const value = new URLSearchParams(search).get('dev');
  if (value === null) return false;
  return value !== '0' && value.toLowerCase() !== 'false';
}
