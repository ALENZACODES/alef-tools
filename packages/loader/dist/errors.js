export class PackError extends Error {
 constructor(code, detail = '') {
  super(detail ? `${code}: ${detail}` : code);
  this.name = 'PackError';
  this.code = code;
 }
}
export function codeOf(e) {
 const any = /** @type {any} */ (e);
 if (any?.code && any.name === 'PackError') return any.code;
 if (any?.name === 'AbortError') return 'aborted';
 if (any?.name === 'QuotaExceededError' || any?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || any?.code === 22) return 'quota';
 return 'failed';
}
