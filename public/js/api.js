/* 与本地练习台服务通信。 */
async function request(path, options = {}) {
  const res = await fetch(path, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-json error */
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `请求失败 (HTTP ${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  health() {
    return request('/health');
  },
  papers() {
    return request('/api/papers');
  },
  paper(id) {
    return request(`/api/papers/${encodeURIComponent(id)}`);
  },
  submit(payload) {
    return request('/api/submissions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  submissions(params = {}) {
    const q = new URLSearchParams();
    if (params.paperId) q.set('paperId', params.paperId);
    if (params.status) q.set('status', params.status);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return request(`/api/submissions${suffix}`);
  },
  feedback(id) {
    return request(`/api/feedback/${encodeURIComponent(id)}`);
  },
  errorWords() {
    return request('/api/error-words');
  },
  importPaper(payload) {
    return request('/api/papers/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
