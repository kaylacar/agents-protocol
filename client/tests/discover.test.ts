import { discover, discoverTxt } from '../src/discover';
import { AgentClientError } from '../src/http';
import { SITE_URL, MANIFEST, mockFetch } from './helpers';

describe('discover', () => {
  it('fetches agents.json from /.well-known/agents.json', async () => {
    const fetchImpl = mockFetch({ 'agents.json': () => MANIFEST });
    const manifest = await discover(SITE_URL, fetchImpl);
    expect(manifest.site.name).toBe('Test Store');
    expect(manifest.capabilities.length).toBeGreaterThan(0);
  });

  it('returns the full manifest structure', async () => {
    const fetchImpl = mockFetch({ 'agents.json': () => MANIFEST });
    const manifest = await discover(SITE_URL, fetchImpl);
    expect(manifest.protocol_version).toBe('0.1.0');
    expect(manifest.session.endpoint).toContain('/session');
    expect(manifest.audit?.enabled).toBe(true);
  });

  it('throws AgentClientError when agents.json is not found', async () => {
    const fetchImpl = async () => new Response('', { status: 404 });
    await expect(discover(SITE_URL, fetchImpl)).rejects.toThrow(AgentClientError);
  });

  it('throws when agents.json is missing required fields', async () => {
    const fetchImpl = mockFetch({ 'agents.json': () => ({ protocol_version: '0.1.0' }) });
    await expect(discover(SITE_URL, fetchImpl)).rejects.toThrow(AgentClientError);
  });

  it('strips trailing slash from site URL', async () => {
    let capturedUrl = '';
    const fetchImpl = async (input: RequestInfo | URL) => {
      capturedUrl = input.toString();
      return new Response(JSON.stringify(MANIFEST), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    await discover(`${SITE_URL}/`, fetchImpl as any);
    expect(capturedUrl).not.toContain('//.');
  });
});

describe('discoverTxt', () => {
  it('fetches agents.txt as plain text', async () => {
    const fetchImpl = async () => new Response('Site: Test Store\n', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
    const txt = await discoverTxt(SITE_URL, fetchImpl as any);
    expect(txt).toContain('Site: Test Store');
  });

  it('throws when agents.txt is not found', async () => {
    const fetchImpl = async () => new Response('', { status: 404 });
    await expect(discoverTxt(SITE_URL, fetchImpl as any)).rejects.toThrow(AgentClientError);
  });
});
