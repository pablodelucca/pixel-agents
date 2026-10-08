import { TERMINAL_LINK_PROTOCOLS, TERMINAL_LINK_WINDOW_FEATURES } from '../constants.js';

/**
 * Open a link the terminal pane was clicked on -- the ONE activation path for
 * both plain URLs (WebLinksAddon) and OSC 8 hyperlinks (Terminal linkHandler).
 *
 * Terminal output is untrusted: an agent that `cat`s a file or prints fetched
 * web content can emit an OSC 8 link whose visible text is innocent and whose
 * target is `javascript:`, `file:` or an OS protocol handler. xterm's built-in
 * OSC 8 activator opens any scheme into a same-origin popup after a generic
 * confirm(), so only http(s) is opened here, straight into a new tab with no
 * opener and no referrer (the page URL carries the server token). Anything
 * else is ignored.
 *
 * Takes `open` (window.open in the app) so this stays DOM-free for the Node
 * test runner.
 */
export function terminalLinkOpener(
  open: (url: string, target: string, features: string) => unknown,
): (event: MouseEvent, uri: string) => void {
  return (_event, uri) => {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return;
    }
    if (!TERMINAL_LINK_PROTOCOLS.includes(url.protocol)) return;
    open(url.href, '_blank', TERMINAL_LINK_WINDOW_FEATURES);
  };
}
