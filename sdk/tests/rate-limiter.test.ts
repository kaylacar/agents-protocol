import { RateLimiter } from '../src/rate-limiter';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it('allows requests under the limit', () => {
    limiter = new RateLimiter();
    const result = limiter.checkRateLimit('user1', 10);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('blocks requests over the limit', () => {
    limiter = new RateLimiter();
    for (let i = 0; i < 5; i++) {
      limiter.checkRateLimit('user1', 5);
    }
    const result = limiter.checkRateLimit('user1', 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('tracks different keys independently', () => {
    limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) {
      limiter.checkRateLimit('user1', 3);
    }
    // user1 is at limit
    expect(limiter.checkRateLimit('user1', 3).allowed).toBe(false);
    // user2 is fresh
    expect(limiter.checkRateLimit('user2', 3).allowed).toBe(true);
  });

  it('decrements remaining count correctly', () => {
    limiter = new RateLimiter();
    expect(limiter.checkRateLimit('x', 5).remaining).toBe(4);
    expect(limiter.checkRateLimit('x', 5).remaining).toBe(3);
    expect(limiter.checkRateLimit('x', 5).remaining).toBe(2);
    expect(limiter.checkRateLimit('x', 5).remaining).toBe(1);
    expect(limiter.checkRateLimit('x', 5).remaining).toBe(0);
    expect(limiter.checkRateLimit('x', 5).allowed).toBe(false);
  });

  it('returns a resetAt timestamp in the future', () => {
    limiter = new RateLimiter();
    const result = limiter.checkRateLimit('user1', 10);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});
