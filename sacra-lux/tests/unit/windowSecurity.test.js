const { isLocalAppUrl, lockWindowNavigation, secureWindow } = require("../../src/windowSecurity");

function createWindow() {
  const listeners = {};
  return {
    listeners,
    webContents: {
      on: jest.fn((name, handler) => {
        listeners[name] = handler;
      }),
      setWindowOpenHandler: jest.fn()
    }
  };
}

describe("isLocalAppUrl", () => {
  test.each([
    "http://localhost:17841/",
    "http://127.0.0.1:17841/screen",
    "http://[::1]:17841/remote",
    "http://192.168.1.20:17841/remote"
  ])("accepts %s", (url) => {
    expect(isLocalAppUrl(url, 17841, "192.168.1.20")).toBe(true);
  });

  test.each([
    "https://evil.example/",
    "http://evil.example:17841/",
    "http://localhost:9999/",
    "https://localhost:17841/",
    "http://192.168.1.99:17841/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url"
  ])("rejects %s", (url) => {
    expect(isLocalAppUrl(url, 17841, "192.168.1.20")).toBe(false);
  });
});

describe("window navigation lock", () => {
  test("cancels navigation outside the local app origin", () => {
    const win = createWindow();
    lockWindowNavigation(win, { getPort: () => 17841 });
    const event = { preventDefault: jest.fn() };

    win.listeners["will-navigate"](event, "https://evil.example/");

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  test("allows navigation inside the local app origin", () => {
    const win = createWindow();
    lockWindowNavigation(win, { getPort: () => 17841 });
    const event = { preventDefault: jest.fn() };

    win.listeners["will-navigate"](event, "http://localhost:17841/app");

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  test("reads the port again on each navigation", () => {
    const win = createWindow();
    let port = 17841;
    lockWindowNavigation(win, { getPort: () => port });
    port = 50000;
    const event = { preventDefault: jest.fn() };

    win.listeners["will-navigate"](event, "http://localhost:50000/");

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  test("secureWindow also denies every new window", () => {
    const win = createWindow();
    secureWindow(win, { getPort: () => 17841 });

    const handler = win.webContents.setWindowOpenHandler.mock.calls[0][0];

    expect(handler({ url: "https://evil.example/" })).toEqual({ action: "deny" });
    expect(handler({ url: "http://localhost:17841/" })).toEqual({ action: "deny" });
  });
});
