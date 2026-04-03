module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/tests/setup/jestWebStorageShim.js"],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 30000
};
