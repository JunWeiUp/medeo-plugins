// `${VAR}` toolchain locations in rule paths: the variable from the environment
// first, then the tool's documented default, so a relocated GOPATH or
// GRADLE_USER_HOME is still found. A default may name another variable; a few
// passes resolve the chain. An unknown variable stays and the path matches nothing.
export const ENV_DEFAULTS: Record<string, string> = {
  GOPATH: '~/go',
  GOMODCACHE: '${GOPATH}/pkg/mod',
  // os.UserCacheDir()/go-build; on macOS it ignores XDG_CACHE_HOME.
  GOCACHE: '~/Library/Caches/go-build',
  XDG_CACHE_HOME: '~/.cache',
  GRADLE_USER_HOME: '~/.gradle',
  CARGO_HOME: '~/.cargo',
  PUB_CACHE: '~/.pub-cache',
  ANDROID_USER_HOME: '~/.android',
  npm_config_cache: '~/.npm',
  npm_config_store_dir: '~/Library/pnpm/store',
  npm_config_cache_dir: '~/Library/Caches/pnpm',
  YARN_CACHE_FOLDER: '~/Library/Caches/Yarn',
  DENO_DIR: '~/Library/Caches/deno',
  PIP_CACHE_DIR: '~/Library/Caches/pip',
  UV_CACHE_DIR: '${XDG_CACHE_HOME}/uv',
  PRE_COMMIT_HOME: '${XDG_CACHE_HOME}/pre-commit',
  POETRY_CACHE_DIR: '~/Library/Caches/pypoetry',
  BUN_INSTALL_CACHE_DIR: '~/Library/Caches/bun',
};
export type Env = Record<string, string | undefined>;

export function resolvePath(path: string, env: Env, home: string): string {
  let resolved = path;
  for (let pass = 0; pass < 4 && resolved.includes('${'); pass++) {
    const next = resolved.replace(/\$\{([^}]*)\}/g, (token, name: string) => env[name] || ENV_DEFAULTS[name] || token);
    if (next === resolved) break;
    resolved = next;
  }
  return expandHome(resolved, home);
}
export function expandHome(path: string, home: string): string {
  return path === '~' ? home : path.startsWith('~/') ? home + path.slice(1) : path;
}
