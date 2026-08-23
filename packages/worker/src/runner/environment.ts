const INHERITED_ENV = new Set([
  'ALL_PROXY',
  'APPDATA',
  'CODEX_HOME',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOME',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LOCALAPPDATA',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
]);

function isSafeLocaleVariable(name: string): boolean {
  return name === 'LANGUAGE' || name.startsWith('LC_');
}

/** Inherit runtime basics, but do not expose the worker's unrelated secrets. */
export function runnerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (INHERITED_ENV.has(name.toUpperCase()) || isSafeLocaleVariable(name.toUpperCase())) {
      result[name] = value;
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete result[name];
    else result[name] = value;
  }
  return result;
}
