const originalFetch = globalThis.fetch;

function buildEnvPayload() {
  const env = {
    BASE_URL: '/',
    MODE: process.env.NODE_ENV || 'test',
    DEV: process.env.NODE_ENV !== 'production',
    PROD: process.env.NODE_ENV === 'production',
    SSR: true
  };
  return JSON.stringify({ env });
}

if (typeof originalFetch === 'function') {
  const envBody = buildEnvPayload();
  const envResponse = new Response(envBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });

  globalThis.fetch = async function viteEnvAwareFetch(input, init) {
    const target = typeof input === 'string' ? input : input?.url;
    if (target && target.includes('@vite/env')) {
      return envResponse.clone();
    }

    return originalFetch(input, init);
  };
}

if (!globalThis.importMetaEnvShim) {
  globalThis.importMetaEnvShim = {
    BASE_URL: '/',
    MODE: process.env.NODE_ENV || 'test',
    DEV: process.env.NODE_ENV !== 'production',
    PROD: process.env.NODE_ENV === 'production',
    SSR: true
  };
}
