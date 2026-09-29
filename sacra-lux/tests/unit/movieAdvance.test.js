const { createMovieEndGuard } = require("../../src/movieAdvance");

describe("movie end guard", () => {
  test("advances once when several screens report the same movie", () => {
    const guard = createMovieEndGuard();

    expect(guard.alreadyHandled(4, "movie:intro:1")).toBe(false);
    guard.markHandled(4, "movie:intro:1");

    expect(guard.alreadyHandled(4, "movie:intro:1")).toBe(true);
    expect(guard.alreadyHandled(4, "movie:intro:1")).toBe(true);
  });

  test("treats a different slide index as a fresh event", () => {
    const guard = createMovieEndGuard();
    guard.markHandled(4, "movie:intro:1");

    expect(guard.alreadyHandled(5, "movie:intro:1")).toBe(false);
  });

  test("treats the same slide reached again as a fresh event", () => {
    const guard = createMovieEndGuard();
    guard.markHandled(4, "movie:intro:1");

    expect(guard.alreadyHandled(4, "movie:anthem:1")).toBe(false);
  });

  test("reset clears the handled report", () => {
    const guard = createMovieEndGuard();
    guard.markHandled(4, "movie:intro:1");
    guard.reset();

    expect(guard.alreadyHandled(4, "movie:intro:1")).toBe(false);
  });
});
