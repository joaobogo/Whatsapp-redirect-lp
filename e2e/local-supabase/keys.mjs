// Test keys for the local Supabase stand-in. Tests only.
import crypto from 'node:crypto';

// A fixed, public test secret. It protects nothing: this server is for tests.
export const JWT_SECRET =
  process.env.LOCAL_JWT_SECRET ?? 'local-test-secret-not-for-production-use';

const b64 = (value) => Buffer.from(value).toString('base64url');

export function signJwt(payload) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${signature}`;
}

export function verifyJwt(token) {
  const [head, body, signature] = (token ?? '').split('.');
  if (!head || !body || !signature) return null;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${head}.${body}`)
    .digest('base64url');
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// fixed expiry (year 2100) so the two test keys are the same on every start
const FAR_FUTURE = 4102444800;
export const ANON_KEY = signJwt({ role: 'anon', iss: 'local-test', exp: FAR_FUTURE });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'local-test', exp: FAR_FUTURE });
