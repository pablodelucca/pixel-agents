function createStateStore() {
  // electron-store is ESM-only in v10+, use dynamic import
  let store = null;
  const storeReady = import('electron-store').then((mod) => {
    const Store = mod.default;
    store = new Store({
      name: 'pixel-agents',
      defaults: {
        soundEnabled: true,
        agents: [],
        agentSeats: {},
        projectDirectory: null,
      },
    });
  });

  return {
    get(key, defaultValue) {
      if (!store) return defaultValue;
      return store.get(key, defaultValue);
    },
    set(key, val) {
      if (!store) return;
      store.set(key, val);
    },
    delete(key) {
      if (!store) return;
      store.delete(key);
    },
    ready() {
      return storeReady;
    },
  };
}

module.exports = { createStateStore };
