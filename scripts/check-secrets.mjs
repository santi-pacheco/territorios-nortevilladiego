// Fails CI if secrets or v1 PII leak into source, config or build output.
// Dependency-free on purpose: it must run before (and without) a test runner.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOTS = ['apps', 'packages', 'supabase'];
// The build output is gitignored but present in CI right before check:secrets runs.
const BUILD_DIRS = ['apps/web/dist'];
const SKIP = new Set(['node_modules', '.git', 'android', 'ios', 'dist-mobile', '.vercel']);
const TEXT_FILE = /\.(m?[jt]sx?|json|sql|html|css|md|toml|ya?ml|xml|svg|txt|webmanifest|kml)$/i;
const MAX_BYTES = 5_000_000;
const SELF = fileURLToPath(import.meta.url);

// Literal secret shapes. Keep these non-global: they are reused with .test().
const SECRET_PATTERNS = [
  { name: 'service_role literal', test: (t) => /service_role/i.test(t) },
  { name: 'Supabase secret key', test: (t) => /sb_secret_[A-Za-z0-9]/.test(t) },
  { name: 'private key block', test: (t) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t) },
];
// Extra literals (e.g. leaked v1 password) come from env so they are never committed themselves.
const ENV_LITERALS = (process.env.FORBIDDEN_LITERALS ?? '').split(',').filter(Boolean);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Reserved/example domains and documented placeholders are not personal data.
const EMAIL_ALLOW_EXACT = new Set(['noreply@anthropic.com', 'admin@email.com']);
const EMAIL_ALLOW_DOMAIN = new Set(['example.com', 'example.org', 'example.net']);
// Only these TLDs are treated as real: it keeps the scan quiet on minified/obfuscated bundles.
const EMAIL_TLD = new Set(['com', 'org', 'net', 'ar', 'edu', 'gob', 'gov', 'info', 'biz', 'int', 'mil']);

// Argentine landline/mobile shapes: +54 …, 0<area> …, (0<area>) …, or the local mobile "15" marker.
// The area code starts with 11 or 2-9 so UUID chunks like "0000-4000-8000" do not match.
const PHONE_AR_RE =
  /(?:\+54|0054)[\s.()-]*9?[\s.()-]*\d{2,4}[\s.()-]*\d{3,4}[\s.()-]*\d{4}\b|\b0(?:11|[2-9]\d{2,3})[\s.-]\d{3,4}[\s.-]\d{4}\b|\b\d{2,4}[\s.-]15[\s.-]\d{3,4}[\s.-]\d{4}\b|\b\(\s*0?\d{2,4}\s*\)[\s.-]*\d{3,4}[\s.-]*\d{4}\b/;

// A JWT is base64url, so the literal "service_role" rule cannot see the role. Decode the payload.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;

export function isAllowedEmail(email) {
  const lower = email.toLowerCase();
  if (EMAIL_ALLOW_EXACT.has(lower)) return true;
  const domain = lower.slice(lower.lastIndexOf('@') + 1);
  return (
    EMAIL_ALLOW_DOMAIN.has(domain) ||
    domain.endsWith('.local') ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.example')
  );
}

function redactEmail(email) {
  const at = email.lastIndexOf('@');
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

function looksLikeRealEmail(email) {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return EMAIL_TLD.has(domain.slice(domain.lastIndexOf('.') + 1).toLowerCase());
}

function jwtHasServiceRole(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    return data?.role === 'service_role';
  } catch {
    return false;
  }
}

/** Returns every issue found in one text blob. Exported for the node --test fixtures. */
export function scanText(text, filePath = '') {
  const findings = [];
  const seen = new Set();
  const add = (kind, message) => {
    const key = `${kind}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, message });
  };

  for (const pattern of SECRET_PATTERNS) if (pattern.test(text)) add('secret', pattern.name);
  for (const literal of ENV_LITERALS) if (text.includes(literal)) add('secret', 'forbidden literal');

  for (const match of text.matchAll(EMAIL_RE)) {
    // "scheme://user:pw@host" is URL credentials (e.g. a test of rejected push endpoints), not an e-mail.
    const before = text.slice(Math.max(0, (match.index ?? 0) - 80), match.index ?? 0);
    if (/:\/\/[^\s/'"`]*$/.test(before)) continue;
    if (!isAllowedEmail(match[0]) && looksLikeRealEmail(match[0])) add('pii', `e-mail ${redactEmail(match[0])}`);
  }

  // A mailto: link is only tolerated in supabase config/docs (the owner's VAPID subject).
  const posixPath = filePath.replace(/\\/g, '/');
  if (/mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/i.test(text) && /(^|\/)(apps|packages)\//.test(posixPath)) {
    add('pii', 'mailto: link in application code');
  }

  for (const match of text.matchAll(JWT_RE)) {
    if (jwtHasServiceRole(match[0])) add('secret', 'JWT with service_role payload');
  }

  if (PHONE_AR_RE.test(text)) add('pii', 'Argentine phone number');

  return findings;
}

/** Walks a directory, returning `{ kind, message, file }` findings. `seen` dedupes overlapping roots. */
export function scanDir(dir, findings = [], seen = new Set()) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return findings;
  }
  for (const name of names) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    let stats;
    try {
      stats = statSync(path);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      scanDir(path, findings, seen);
      continue;
    }
    if (stats.size >= MAX_BYTES || !TEXT_FILE.test(name)) continue;
    const key = path.toLowerCase();
    if (seen.has(key) || path === SELF) continue;
    seen.add(key);
    for (const finding of scanText(readFileSync(path, 'utf8'), path)) findings.push({ ...finding, file: path });
  }
  return findings;
}

export function main() {
  const findings = [];
  const seen = new Set();
  for (const dir of [...ROOTS, ...BUILD_DIRS]) if (existsSync(dir)) scanDir(dir, findings, seen);
  if (findings.length) {
    for (const finding of findings) console.error(`${finding.kind} pattern (${finding.message}) in ${finding.file}`);
    process.exitCode = 1;
  } else {
    console.log('check-secrets: clean');
  }
  return findings;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
