#!/usr/bin/env node
// A small stand-in for a Supabase project, for automated tests only.
//
// It speaks just enough of Supabase's HTTP API (Auth + the REST data API) for
// this app, on top of a plain Postgres database that has the migration and
// seed applied (see supabase/tests/run.sh). Requests run as the caller's
// database role with their JWT claims set, so the real row level security
// policies and triggers decide what happens - the point of the test.
//
// It has no Realtime, which is fine: the app falls back to polling.
// NEVER use this for anything but tests. A real deployment uses Supabase.
//
//   LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/fgv_e2e \
//     node e2e/local-supabase/server.mjs
import crypto from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { ANON_KEY, SERVICE_KEY, signJwt, verifyJwt } from './keys.mjs';

const PORT = Number(process.env.LOCAL_SUPABASE_PORT ?? 54321);
const DATABASE_URL = process.env.LOCAL_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set LOCAL_DATABASE_URL to a throwaway Postgres database.');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
const ROLES = new Set(['anon', 'authenticated', 'service_role']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

// --- helpers -----------------------------------------------------------------
class HttpError extends Error {
  constructor(status, body) {
    super(body.message ?? 'error');
    this.status = status;
    this.body = body;
  }
}

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS',
    'access-control-expose-headers': 'content-range',
    ...headers,
  });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, { code: 'PGRST102', message: 'Invalid JSON body' });
  }
}

function claimsOf(req) {
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verifyJwt(bearer) ?? verifyJwt(req.headers.apikey);
  if (!claims || !ROLES.has(claims.role)) {
    throw new HttpError(401, { code: 'PGRST301', message: 'Invalid or missing API key' });
  }
  return claims;
}

/** Runs SQL as the caller: their database role, their JWT claims, real RLS. */
async function asCaller(claims, work) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${claims.role}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ]);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    if (error instanceof HttpError) throw error;
    const status = error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400;
    throw new HttpError(status, {
      code: error.code ?? 'XX000',
      message: error.message,
      details: error.detail ?? null,
      hint: error.hint ?? null,
    });
  } finally {
    client.release();
  }
}

// --- REST: filters -------------------------------------------------------------
function columnSql(name) {
  const path = /^([a-z_][a-z0-9_]*)->>([a-z_][a-z0-9_]*)$/.exec(name);
  if (path) return `"${path[1]}"->>'${path[2]}'`;
  if (!IDENT.test(name))
    throw new HttpError(400, { code: 'PGRST100', message: `Bad column: ${name}` });
  return `"${name}"`;
}

function conditionSql(column, expression, params) {
  let rest = expression;
  let negate = false;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  const op = dot === -1 ? rest : rest.slice(0, dot);
  const value = dot === -1 ? '' : rest.slice(dot + 1);
  const col = columnSql(column);
  const param = (item) => {
    params.push(item);
    return `$${params.length}`;
  };
  let sql;
  switch (op) {
    case 'eq':
      sql = `${col} = ${param(value)}`;
      break;
    case 'neq':
      sql = `${col} <> ${param(value)}`;
      break;
    case 'gt':
      sql = `${col} > ${param(value)}`;
      break;
    case 'gte':
      sql = `${col} >= ${param(value)}`;
      break;
    case 'lt':
      sql = `${col} < ${param(value)}`;
      break;
    case 'lte':
      sql = `${col} <= ${param(value)}`;
      break;
    case 'like':
      sql = `${col} like ${param(value.replaceAll('*', '%'))}`;
      break;
    case 'ilike':
      sql = `${col} ilike ${param(value.replaceAll('*', '%'))}`;
      break;
    case 'is':
      if (!['null', 'true', 'false'].includes(value)) {
        throw new HttpError(400, { code: 'PGRST100', message: `Bad is. value: ${value}` });
      }
      sql = `${col} is ${value}`;
      break;
    case 'in': {
      const list = value
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((item) => item.replace(/^"|"$/g, ''))
        .filter((item) => item.length > 0);
      sql = `${col} = any(${param(list)})`;
      break;
    }
    default:
      throw new HttpError(400, { code: 'PGRST100', message: `Unsupported filter: ${op}` });
  }
  return negate ? `not (${sql})` : sql;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += char;
  }
  if (current) parts.push(current);
  return parts;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function whereSql(query, params) {
  const conditions = [];
  for (const [key, value] of query.entries()) {
    if (RESERVED.has(key)) continue;
    if (key === 'or') {
      const inner = value.replace(/^\(/, '').replace(/\)$/, '');
      const options = splitTopLevel(inner).map((part) => {
        const dot = part.indexOf('.');
        return conditionSql(part.slice(0, dot), part.slice(dot + 1), params);
      });
      conditions.push(`(${options.join(' or ')})`);
    } else {
      conditions.push(conditionSql(key, value, params));
    }
  }
  return conditions.length > 0 ? ` where ${conditions.join(' and ')}` : '';
}

function selectSql(query) {
  const raw = (query.get('select') ?? '*').trim();
  if (raw === '*' || raw === '') return '*';
  return raw
    .split(',')
    .map((part) => part.trim())
    .map((part) => (part === '*' ? '*' : columnSql(part)))
    .join(', ');
}

function orderSql(query) {
  const raw = query.get('order');
  if (!raw) return '';
  const parts = raw.split(',').map((part) => {
    const [column, ...flags] = part.split('.');
    let sql = columnSql(column);
    sql += flags.includes('desc') ? ' desc' : ' asc';
    if (flags.includes('nullslast')) sql += ' nulls last';
    if (flags.includes('nullsfirst')) sql += ' nulls first';
    return sql;
  });
  return ` order by ${parts.join(', ')}`;
}

function limitSql(query) {
  const whole = (name) => {
    const raw = query.get(name);
    const value = raw === null || raw === '' ? NaN : Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  };
  const limit = whole('limit');
  const offset = whole('offset');
  return (limit === null ? '' : ` limit ${limit}`) + (offset ? ` offset ${offset}` : '');
}

function respondRows(req, res, rows, status, total) {
  const prefer = req.headers.prefer ?? '';
  const headers = {};
  if (total !== undefined) {
    headers['content-range'] = rows.length > 0 ? `0-${rows.length - 1}/${total}` : `*/${total}`;
  }
  if (req.method === 'HEAD') return send(res, 200, undefined, headers);
  if ((req.headers.accept ?? '').includes('application/vnd.pgrst.object+json')) {
    if (rows.length !== 1) {
      return send(res, 406, {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: `The result contains ${rows.length} rows`,
        hint: null,
      });
    }
    return send(res, status, rows[0], headers);
  }
  if (req.method !== 'GET' && !prefer.includes('return=representation')) {
    return send(res, status === 200 ? 204 : status, undefined, headers);
  }
  return send(res, status, rows, headers);
}

async function handleTable(req, res, table, query, claims) {
  if (!IDENT.test(table)) throw new HttpError(404, { code: 'PGRST205', message: 'Unknown table' });
  const target = `public."${table}"`;
  const prefer = req.headers.prefer ?? '';

  if (req.method === 'GET' || req.method === 'HEAD') {
    return asCaller(claims, async (db) => {
      const params = [];
      const where = whereSql(query, params);
      let total;
      if (prefer.includes('count=exact')) {
        const counted = await db.query(`select count(*)::int as n from ${target}${where}`, params);
        total = counted.rows[0].n;
      }
      const rows =
        req.method === 'HEAD'
          ? []
          : (
              await db.query(
                `select ${selectSql(query)} from ${target}${where}${orderSql(query)}${limitSql(query)}`,
                params,
              )
            ).rows;
      respondRows(req, res, rows, 200, total);
    });
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    const records = Array.isArray(body) ? body : [body ?? {}];
    const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
    columns.forEach(columnSql);
    return asCaller(claims, async (db) => {
      const list = columns.map((column) => `"${column}"`).join(', ');
      let sql =
        columns.length === 0
          ? `insert into ${target} default values`
          : `insert into ${target} (${list}) select ${list} from jsonb_populate_recordset(null::${target}, $1::jsonb)`;
      if (prefer.includes('resolution=merge-duplicates')) {
        let conflict = (query.get('on_conflict') ?? '').split(',').filter(Boolean);
        if (conflict.length === 0) {
          const keys = await db.query(
            `select a.attname from pg_index i join pg_attribute a
               on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
              where i.indrelid = $1::regclass and i.indisprimary`,
            [`public.${table}`],
          );
          conflict = keys.rows.map((row) => row.attname);
        }
        conflict.forEach(columnSql);
        const updates = columns
          .filter((column) => !conflict.includes(column))
          .map((column) => `"${column}" = excluded."${column}"`);
        sql += ` on conflict (${conflict.map((column) => `"${column}"`).join(', ')}) `;
        sql += updates.length > 0 ? `do update set ${updates.join(', ')}` : 'do nothing';
      }
      sql += ` returning ${selectSql(query)}`;
      const result = await db.query(sql, columns.length === 0 ? [] : [JSON.stringify(records)]);
      respondRows(req, res, result.rows, 201);
    });
  }

  if (req.method === 'PATCH') {
    const body = (await readBody(req)) ?? {};
    const columns = Object.keys(body);
    columns.forEach(columnSql);
    if (columns.length === 0) return respondRows(req, res, [], 200);
    return asCaller(claims, async (db) => {
      const params = [JSON.stringify(body)];
      const list = columns.map((column) => `"${column}"`).join(', ');
      const where = whereSql(query, params);
      const result = await db.query(
        `update ${target} set (${list}) = (select ${list} from jsonb_populate_record(null::${target}, $1::jsonb))${where} returning ${selectSql(query)}`,
        params,
      );
      respondRows(req, res, result.rows, 200);
    });
  }

  if (req.method === 'DELETE') {
    return asCaller(claims, async (db) => {
      const params = [];
      const where = whereSql(query, params);
      const result = await db.query(
        `delete from ${target}${where} returning ${selectSql(query)}`,
        params,
      );
      respondRows(req, res, result.rows, 200);
    });
  }
  throw new HttpError(405, { code: 'PGRST117', message: 'Unsupported method' });
}

async function handleRpc(req, res, name, claims) {
  if (!IDENT.test(name))
    throw new HttpError(404, { code: 'PGRST202', message: 'Unknown function' });
  const args = (await readBody(req)) ?? {};
  const keys = Object.keys(args);
  keys.forEach(columnSql);
  return asCaller(claims, async (db) => {
    const info = await db.query(
      `select t.typname, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype
        where p.pronamespace = 'public'::regnamespace and p.proname = $1 limit 1`,
      [name],
    );
    if (info.rowCount === 0)
      throw new HttpError(404, { code: 'PGRST202', message: 'Unknown function' });
    const call = `public."${name}"(${keys.map((key, index) => `"${key}" := $${index + 1}`).join(', ')})`;
    const values = keys.map((key) => args[key]);
    if (info.rows[0].typname === 'void') {
      await db.query(`select ${call}`, values);
      return send(res, 204, undefined);
    }
    const result = await db.query(`select to_jsonb(${call}) as value`, values);
    let value = result.rows[0]?.value ?? null;
    // like PostgREST, an empty composite result is null rather than a row of nulls
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'id' in value &&
      value.id === null
    ) {
      value = null;
    }
    send(res, 200, value);
  });
}

// --- Auth ----------------------------------------------------------------------
const otps = new Map(); // email -> code
const refreshTokens = new Map(); // refresh token -> user id

function requireService(claims) {
  if (claims.role !== 'service_role') {
    throw new HttpError(403, { code: 'not_admin', message: 'User not allowed' });
  }
}

async function ensureUser(email) {
  const clean = String(email ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(clean)) {
    throw new HttpError(400, { code: 'validation_failed', message: 'Invalid email' });
  }
  const found = await pool.query('select id, email from auth.users where email = $1', [clean]);
  if (found.rowCount > 0) return found.rows[0];
  const made = await pool.query('insert into auth.users (email) values ($1) returning id, email', [
    clean,
  ]);
  return made.rows[0];
}

function userObject(user) {
  const now = new Date().toISOString();
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: now,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function sessionFor(user) {
  const expiresIn = 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const accessToken = signJwt({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'local-test',
    exp: expiresAt,
    session_id: crypto.randomUUID(),
  });
  const refreshToken = crypto.randomBytes(18).toString('base64url');
  refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: userObject(user),
  };
}

function newCode(email) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  otps.set(email, code);
  return code;
}

async function handleAuth(req, res, path, query) {
  if (req.method === 'POST' && path === '/otp') {
    const body = (await readBody(req)) ?? {};
    const user = await ensureUser(body.email);
    newCode(user.email);
    return send(res, 200, {});
  }
  if (req.method === 'POST' && path === '/verify') {
    const body = (await readBody(req)) ?? {};
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    const expected = otps.get(email);
    if (!expected || expected !== String(body.token ?? '').trim()) {
      return send(res, 403, {
        code: 403,
        error_code: 'otp_expired',
        msg: 'Token has expired or is invalid',
      });
    }
    otps.delete(email);
    return send(res, 200, sessionFor(await ensureUser(email)));
  }
  if (req.method === 'POST' && path === '/token' && query.get('grant_type') === 'refresh_token') {
    const body = (await readBody(req)) ?? {};
    const userId = refreshTokens.get(body.refresh_token);
    if (!userId) {
      return send(res, 400, {
        code: 400,
        error_code: 'refresh_token_not_found',
        msg: 'Invalid Refresh Token',
      });
    }
    refreshTokens.delete(body.refresh_token);
    const found = await pool.query('select id, email from auth.users where id = $1', [userId]);
    return send(res, 200, sessionFor(found.rows[0]));
  }
  if (req.method === 'GET' && path === '/user') {
    const claims = verifyJwt((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    if (!claims?.sub)
      return send(res, 401, { code: 401, error_code: 'no_authorization', msg: 'Invalid JWT' });
    const found = await pool.query('select id, email from auth.users where id = $1', [claims.sub]);
    if (found.rowCount === 0) {
      return send(res, 401, { code: 401, error_code: 'user_not_found', msg: 'User not found' });
    }
    return send(res, 200, userObject(found.rows[0]));
  }
  if (req.method === 'POST' && path === '/logout') return send(res, 204, undefined);

  // admin endpoints: service role only
  const claims = claimsOf(req);
  if (req.method === 'POST' && path === '/admin/generate_link') {
    requireService(claims);
    const body = (await readBody(req)) ?? {};
    const user = await ensureUser(body.email);
    const code = newCode(user.email);
    return send(res, 200, {
      ...userObject(user),
      action_link: `http://127.0.0.1:${PORT}/auth/v1/verify?token=${code}&type=magiclink`,
      email_otp: code,
      hashed_token: code,
      verification_type: 'magiclink',
      redirect_to: body.redirect_to ?? '',
    });
  }
  if (req.method === 'GET' && path === '/admin/users') {
    requireService(claims);
    const all = await pool.query('select id, email from auth.users order by email');
    return send(res, 200, { users: all.rows.map(userObject), aud: 'authenticated' });
  }
  if (req.method === 'POST' && path === '/invite') {
    requireService(claims);
    const body = (await readBody(req)) ?? {};
    return send(res, 200, userObject(await ensureUser(body.email)));
  }
  return send(res, 404, { code: 404, msg: 'Not found' });
}

// --- server --------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, undefined);
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/auth/v1')) {
      return await handleAuth(req, res, url.pathname.slice('/auth/v1'.length), url.searchParams);
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      return await handleRpc(req, res, url.pathname.slice('/rest/v1/rpc/'.length), claimsOf(req));
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      return await handleTable(
        req,
        res,
        url.pathname.slice('/rest/v1/'.length),
        url.searchParams,
        claimsOf(req),
      );
    }
    return send(res, 404, { message: 'Not found (this test server has no Realtime or Storage)' });
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, error.body);
    console.error(error);
    return send(res, 500, { code: 'XX000', message: 'Test server error' });
  }
});

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? '')) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Local Supabase stand-in on http://127.0.0.1:${PORT}`);
    if (process.argv.includes('--print-keys')) {
      console.log(`ANON_KEY=${ANON_KEY}`);
      console.log(`SERVICE_KEY=${SERVICE_KEY}`);
    }
  });
}
