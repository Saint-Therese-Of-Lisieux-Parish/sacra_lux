describe("web entry point", () => {
  const originalPort = process.env.PORT;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.PORT;
  });

  afterAll(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
      return;
    }
    process.env.PORT = originalPort;
  });

  test("starts the server on the configured PORT", () => {
    const startServer = jest.fn();
    process.env.PORT = "19555";

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(19555);
  });

  test("falls back to the default port when PORT is unset", () => {
    const startServer = jest.fn();

    jest.doMock("../../src/server", () => ({ startServer }));

    require("../../src/web");

    expect(startServer).toHaveBeenCalledWith(17841);
  });
});
