/**
 * Navigation limits for Electron windows.
 * Each window may show only pages from the local Sacra Lux server.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Return true when the URL points at the local app server.
 * The local app origin is http on the app port, on a loopback host
 * or on the local network address of this computer.
 */
function isLocalAppUrl(rawUrl, port, localAddress = "") {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  if (parsed.port !== String(port)) return false;
  return LOCAL_HOSTNAMES.has(parsed.hostname) || (Boolean(localAddress) && parsed.hostname === localAddress);
}

/**
 * Cancel navigation to any URL outside the local app origin.
 * `getPort` and `getLocalAddress` run on each event because the port can change at start.
 */
function lockWindowNavigation(win, { getPort, getLocalAddress = () => "" }) {
  win.webContents.on("will-navigate", (event, url) => {
    if (!isLocalAppUrl(url, getPort(), getLocalAddress())) {
      event.preventDefault();
    }
  });
}

/**
 * Lock one window: cancel outside navigation and deny every new window.
 * The app window replaces the open handler to allow the remote popup.
 */
function secureWindow(win, options) {
  lockWindowNavigation(win, options);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

module.exports = { isLocalAppUrl, lockWindowNavigation, secureWindow };
