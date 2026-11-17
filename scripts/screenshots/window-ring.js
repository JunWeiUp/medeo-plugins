/*shots {"shots":[{"name":"overview","width":900,"height":700,"dark":true},{"name":"shortcuts","width":900,"height":700,"dark":true}]} */
// Made-up state for the README screenshots: no window is moved and nothing is registered.
(() => {
  const defaults = {
    ring: 'Control+Alt+R', 'left-half': 'Control+Alt+Left', 'right-half': 'Control+Alt+Right', 'top-half': 'Control+Alt+Up',
    'bottom-half': 'Control+Alt+Down', maximize: 'Control+Alt+Enter', center: 'Control+Alt+C', 'top-left': 'Control+Alt+U',
    'top-right': 'Control+Alt+I', 'bottom-left': 'Control+Alt+J', 'bottom-right': 'Control+Alt+K', 'left-third': 'Control+Alt+D',
    'center-third': 'Control+Alt+F', 'right-third': 'Control+Alt+G', 'next-display': 'Control+Alt+N', undo: 'Control+Alt+Backspace',
  };
  const accelerators = { ...defaults, center: 'Control+Alt+M' };
  const status = {
    plugin: true, os: 'granted', tray: true, storage: true, customized: ['center'], accelerators,
    bindings: Object.fromEntries(Object.keys(defaults).map(id => [id, 'registered'])),
  };
  globalThis.demo = {
    post(message, emit, shot) {
      if (message.type !== 'hello') return;
      emit({ type: 'status', status });
      // A layout "just applied" pins the diagram (it also stops the idle tour).
      emit({ type: 'applied', action: shot === 'shortcuts' ? 'top-right' : 'left-half' });
    },
    after(shot) {
      if (shot === 'shortcuts') {
        const card = document.getElementById('groups')?.closest('.card');
        if (card) scrollTo(0, card.getBoundingClientRect().top + scrollY - 16);
        document.querySelector('[data-testid="window-ring.binding.left-half.record"]')?.click();
      }
      document.body.dataset.viewport = innerWidth + 'x' + innerHeight + '@' + devicePixelRatio;
    },
  };
})();
