const crypto = require('node:crypto');

const CODE_TTL = 10 * 60 * 1000;
const COOLDOWN = 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

class AccountError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError(400, 'Enter a valid email address.');
  return email;
}

function createAccountSecurity({ db, auth, sendCode, secret, now = Date.now }) {
  if (!secret) throw new Error('Account security secret is missing.');
  const hash = (value) => crypto.createHmac('sha256', secret).update(value).digest('hex');
  const challengeRef = (purpose, email) => db.doc(`accountChallenges/${hash(`${purpose}:${email}`)}`);

  async function rateLimit(ip) {
    const ref = db.doc(`accountRateLimits/${hash(`ip:${ip || 'unknown'}`)}`);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const previous = snapshot.exists ? snapshot.data() : {};
      const inWindow = now() - previous.windowStart < HOUR;
      if (inWindow && previous.count >= 60) throw new AccountError(429, 'Too many attempts. Please try again later.', 3600);
      transaction.set(ref, { windowStart: inWindow ? previous.windowStart : now(), count: inWindow ? previous.count + 1 : 1, expiresAt: new Date(now() + HOUR) });
    });
  }

  async function requestCode({ purpose, email: inputEmail, uid, ip, name }) {
    await rateLimit(ip);
    let user;
    let email;
    if (purpose === 'verify') {
      user = await auth.getUser(uid);
      if (user.disabled || !user.email) throw new AccountError(403, 'This account cannot receive a verification code.');
      if (user.emailVerified) return { alreadyVerified: true };
      email = normalizeEmail(user.email);
    } else if (purpose === 'reset') {
      email = normalizeEmail(inputEmail);
      try { user = await auth.getUserByEmail(email); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      if (user?.disabled) user = undefined;
    } else {
      throw new AccountError(400, 'Choose a valid code purpose.');
    }
    const ref = challengeRef(purpose, email);
    const id = crypto.randomBytes(24).toString('hex');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const previous = snapshot.exists ? snapshot.data() : {};
      const inWindow = now() - previous.windowStart < HOUR;
      const wait = previous.sentAt + COOLDOWN - now();
      if (wait > 0) throw new AccountError(429, 'Please wait before requesting another code.', Math.ceil(wait / 1000));
      if (inWindow && previous.sendCount >= 5) throw new AccountError(429, 'Too many code requests. Please try again in an hour.', 3600);
      transaction.set(ref, {
        id, purpose, email, uid: user?.uid || null, codeHash: hash(`${id}:${code}`), attempts: 0,
        sentAt: now(), expires: now() + CODE_TTL, expiresAt: new Date(now() + HOUR),
        windowStart: inWindow ? previous.windowStart : now(), sendCount: inWindow ? previous.sendCount + 1 : 1,
        used: false,
      });
    });
    if (user) {
      try { await sendCode({ email, name: user.displayName || (purpose === 'verify' && typeof name === 'string' ? name.trim().slice(0, 100) : '') || 'Runner', purpose, code }); }
      catch {
        // Do not log SMTP errors: provider diagnostics can contain credentials.
        // Invalidate this delivery without overwriting a newer request.
        await db.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          if (current.data()?.id === id) transaction.update(ref, { used: true });
        });
        throw new AccountError(503, 'Email delivery is temporarily unavailable. Please try again in a minute.', COOLDOWN / 1000);
      }
    }
    // Unknown reset addresses get the same response and cooldown as real accounts.
    return { challengeId: id, expiresIn: CODE_TTL / 1000, retryAfter: COOLDOWN / 1000 };
  }

  async function checkCode({ purpose, email: inputEmail, uid, challengeId, code, ip }) {
    await rateLimit(ip);
    if (!['verify', 'reset'].includes(purpose)) throw new AccountError(400, 'Choose a valid code purpose.');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || typeof challengeId !== 'string' || !/^[a-f0-9]{48}$/.test(challengeId)) throw new AccountError(400, 'Enter the six-digit code from your email.');
    const user = purpose === 'verify' ? await auth.getUser(uid) : null;
    const email = normalizeEmail(user ? user.email : inputEmail);
    const ref = challengeRef(purpose, email);
    const resetToken = crypto.randomBytes(32).toString('hex');
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const challenge = snapshot.exists ? snapshot.data() : null;
      if (!challenge || challenge.used || challenge.expires <= now() || challenge.attempts >= MAX_ATTEMPTS) return { error: 'This code has expired or reached its attempt limit. Request a new code.' };
      const candidate = hash(`${challengeId}:${code}`);
      if (challenge.id !== challengeId || !crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(challenge.codeHash))) {
        transaction.update(ref, { attempts: challenge.attempts + 1 });
        return { error: 'That code is incorrect. Check your latest email and try again.' };
      }
      if (!challenge.uid || (uid && purpose === 'verify' && challenge.uid !== uid)) return { error: 'This code is invalid. Request a new code.' };
      if (purpose === 'reset') {
        transaction.set(db.doc(`accountResetGrants/${hash(resetToken)}`), {
          uid: challenge.uid, email, expires: now() + CODE_TTL, expiresAt: new Date(now() + CODE_TTL), used: false,
        });
      }
      transaction.update(ref, { used: true });
      return { uid: challenge.uid };
    });
    if (result.error) throw new AccountError(400, result.error);
    const current = await auth.getUser(result.uid);
    if (current.disabled || normalizeEmail(current.email) !== email) throw new AccountError(403, 'This account is no longer available.');
    if (purpose === 'verify') {
      await auth.updateUser(result.uid, { emailVerified: true });
      return { verified: true };
    }
    return { resetToken, expiresIn: CODE_TTL / 1000 };
  }

  async function resetPassword({ resetToken, password, ip }) {
    await rateLimit(ip);
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new AccountError(400, 'Use a password between 6 and 128 characters.');
    if (typeof resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(resetToken)) throw new AccountError(400, 'Verify your email code before resetting your password.');
    const ref = db.doc(`accountResetGrants/${hash(resetToken)}`);
    const grant = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists ? snapshot.data() : null;
      if (!data || data.used || data.expires <= now()) throw new AccountError(400, 'Your reset session has expired. Request a new code.');
      transaction.update(ref, { used: true });
      return data;
    });
    const user = await auth.getUser(grant.uid);
    if (user.disabled || normalizeEmail(user.email) !== grant.email) throw new AccountError(403, 'This account is no longer available.');
    await auth.updateUser(grant.uid, { password });
    await auth.revokeRefreshTokens(grant.uid);
    return { reset: true };
  }
  return { requestCode, checkCode, resetPassword };
}

module.exports = { createAccountSecurity, AccountError };
