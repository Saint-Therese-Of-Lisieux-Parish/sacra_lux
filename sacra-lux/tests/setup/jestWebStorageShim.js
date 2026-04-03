function makeStorageShim() {
  const store = new Map();
  return {
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    key(index) {
      const keys = Array.from(store.keys());
      return keys[index] || null;
    },
    removeItem(key) {
      store.delete(String(key));
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    get length() {
      return store.size;
    }
  };
}

for (const key of ["localStorage", "sessionStorage"]) {
  try {
    Object.defineProperty(globalThis, key, {
      value: makeStorageShim(),
      configurable: true,
      writable: true
    });
  } catch {
    // Best effort only. If the runtime forbids override, the tests still run.
  }
}
