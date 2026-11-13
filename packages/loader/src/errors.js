// @ts-check
// One error type for everything that can stop a language pack. `code` is what callers switch on (docs/CONTRACT.md, section 4.4).

export class PackError extends Error {
  /** @param {string} code @param {string} [detail] */
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PackError';
    this.code = code;
  }
}

/** The code of any thrown thing: a PackError's own code, `aborted` for an aborted fetch, `quota` for a full disk, else `failed`. */
export function codeOf(e) {
  const any = /** @type {any} */ (e);
  if (any?.code && any.name === 'PackError') return any.code;
  if (any?.name === 'AbortError') return 'aborted';
  if (any?.name === 'QuotaExceededError' || any?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || any?.code === 22) return 'quota';
  return 'failed';
}
