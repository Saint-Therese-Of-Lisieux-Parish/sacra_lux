describe("preload", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("exposes the documented Electron bridge through contextBridge", async () => {
    const invoke = jest.fn().mockResolvedValue("ok");
    const exposeInMainWorld = jest.fn();
    const on = jest.fn();
    const removeListener = jest.fn();

    jest.doMock("electron", () => ({
      contextBridge: { exposeInMainWorld },
      ipcRenderer: { invoke, on, removeListener }
    }), { virtual: true });

    require("../../src/preload");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld).toHaveBeenCalledWith("api", expect.any(Object));

    const api = exposeInMainWorld.mock.calls[0][1];
    expect(api.isElectron).toBe(true);

    await api.pickFolder();
    await api.pickImageFile();
    await api.pickVideoFile();
    await api.getMonitors();
    const handler = jest.fn();
    const remove = api.onMonitorsChanged(handler);
    await api.setTargetMonitor(3);
    await api.setTargetMonitors([1, 2]);
    await api.setScreenFullscreen(true);
    await api.openMassFolder();
    await api.exportPdf(["mass"], "high");
    await api.exportSlidePdf([{ title: "Slide" }], { fontFamily: "Lora" }, "slides", "medium");

    expect(invoke.mock.calls).toEqual([
      ["dialog:pickFolder"],
      ["dialog:pickImageFile"],
      ["dialog:pickVideoFile"],
      ["screen:getMonitors"],
      ["screen:setTargetMonitor", 3],
      ["screen:setTargetMonitors", [1, 2]],
      ["screen:fullscreen", true],
      ["folder:openMassFolder"],
      ["export:pdf", ["mass"], "high"],
      ["export:slide-pdf", [{ title: "Slide" }], { fontFamily: "Lora" }, "slides", "medium"]
    ]);
    expect(on).toHaveBeenCalledWith("screen:monitors-updated", expect.any(Function));
    const listener = on.mock.calls[0][1];
    listener({}, [{ id: 2 }]);
    expect(handler).toHaveBeenCalledWith([{ id: 2 }]);
    remove();
    expect(removeListener).toHaveBeenCalledWith("screen:monitors-updated", listener);
  });
});
