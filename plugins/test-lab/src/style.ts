// A module brings its own stylesheet: `pack` loads imported .css files as text.
const added = new Set<string>();
export function useStyle(css: string) {
  if (added.has(css)) return;
  added.add(css);
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
}
