const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function sourceError(code, message, { retryable = false } = {}) {
  const error = new Error(`${code}: ${String(message || '采集来源失败')}`);
  error.code = code;
  error.retryable = Boolean(retryable);
  return error;
}

export function classifyHttpResponse(response, detail = '') {
  const status = Number(response?.status || 0);
  const remaining = response?.headers?.get?.('x-ratelimit-remaining');
  const rateLimited = status === 429 || (status === 403 && (remaining === '0' || /rate.?limit|secondary rate/i.test(detail)));
  if (status === 401) return sourceError('AUTH_REQUIRED', `HTTP ${status}`, { retryable: false });
  if (rateLimited) return sourceError('RATE_LIMITED', `HTTP ${status}`, { retryable: true });
  if (status === 403) return sourceError('BLOCKED', `HTTP ${status}`, { retryable: false });
  if (status >= 500) return sourceError('NETWORK_ERROR', `HTTP ${status}`, { retryable: true });
  if (status === 404) return sourceError('BLOCKED', 'SOURCE_UNAVAILABLE: HTTP 404', { retryable: false });
  return sourceError('BLOCKED', `HTTP ${status || '未知'}`, { retryable: false });
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after') || 0);
  if (response?.status === 429 || (response?.status === 403 && response?.headers?.get?.('x-ratelimit-remaining') === '0')) {
    return retryAfter > 0 && retryAfter <= 2 ? retryAfter * 1000 : null;
  }
  if (retryAfter > 0) return retryAfter <= 2 ? retryAfter * 1000 : null;
  return Math.min(1000, 250 * (2 ** attempt));
}

export async function fetchWithBoundedRetry(url, init = {}, { fetchImpl = fetch, timeoutMs = 20000, maxAttempts = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchImpl(url, { ...init, signal });
      if (response.ok || response.status === 304 || (init.redirect === 'manual' && response.status >= 300 && response.status < 400)) return response;
      const detail = response.status === 403 ? await response.clone().text().catch(() => '') : '';
      const error = classifyHttpResponse(response, detail);
      const waitMs = retryDelay(response, attempt);
      if (attempt + 1 < maxAttempts && error.retryable && waitMs != null && (response.status >= 500 || response.status === 429)) {
        await delay(waitMs);
        continue;
      }
      throw error;
    } catch (error) {
      if (['AUTH_REQUIRED', 'RATE_LIMITED', 'BLOCKED', 'OUTPUT_INVALID', 'NETWORK_ERROR', 'TIMEOUT'].includes(error?.code)) throw error;
      lastError = error;
      if (attempt + 1 >= maxAttempts) {
        const timedOut = /timeout|aborted/i.test(`${error?.name || ''} ${error?.message || error} ${error?.cause?.code || error?.code || ''}`);
        throw sourceError(timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', timedOut ? '请求超时' : '网络请求失败', { retryable: true });
      }
      await delay(Math.min(1000, 250 * (2 ** attempt)));
    }
  }
  throw sourceError('NETWORK_ERROR', lastError?.message || '网络请求失败', { retryable: true });
}
