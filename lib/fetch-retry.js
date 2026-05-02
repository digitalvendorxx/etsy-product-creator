// Retry wrapper for OpenRouter API calls (handles 502/503/429 transient errors)
async function fetchWithRetry(url, options, maxRetries = 3, timeoutMs = 30000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      if (attempt === maxRetries) throw err;
      const wait = attempt * 5000;
      console.warn(`  [retry] OpenRouter fetch error (${err.name}: ${err.message}), retrying in ${wait / 1000}s (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    clearTimeout(timer);
    if (response.ok || attempt === maxRetries) return response;
    const status = response.status;
    if (status === 502 || status === 503 || status === 429 || status === 500) {
      const wait = attempt * 5000;
      console.warn(`  [retry] OpenRouter ${status}, retrying in ${wait / 1000}s (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, wait));
    } else {
      return response;
    }
  }
}

module.exports = { fetchWithRetry };
