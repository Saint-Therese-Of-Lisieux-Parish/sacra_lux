module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup/jestWebStorageShim.js"],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000,
  // src/main.js is the Electron entry point. The packaged-app smoke test covers it, not Jest.
  collectCoverageFrom: ["src/**/*.js", "!src/main.js"],
  coverageReporters: ["text-summary", "lcov"],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 63,
      functions: 89,
      lines: 81
    },
    "./src/security.js": {
      lines: 89,
      branches: 69
    },
    "./src/massDocument.js": {
      lines: 97,
      branches: 85
    },
    "./src/atomicWrite.js": {
      lines: 90,
      branches: 80
    }
  }
};
