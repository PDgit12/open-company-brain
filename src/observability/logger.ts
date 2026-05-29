/**
 * Minimal structured logger — observability without a heavy dependency.
 *
 * Emits one JSON line per event so logs are greppable and pipeline-friendly.
 * Swap for pino/winston later; the call sites stay the same.
 */

type Fields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}): void {
  // ISO timestamp is fine here (app runtime, not a workflow script).
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
  request: (method: string, path: string, status: number, ms: number) =>
    emit('info', 'http_request', { method, path, status, ms: Math.round(ms * 10) / 10 }),
};
