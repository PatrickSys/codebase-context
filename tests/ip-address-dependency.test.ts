import { createServer, get, type RequestListener } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@modelcontextprotocol/sdk/server/index.js'));
const parentPath = sdkRequire.resolve('express-rate-limit');
const parentRequire = createRequire(parentPath);
const leafPath = parentRequire.resolve('ip-address');

interface Address {
  correctForm(): string;
  isInSubnet(network: Address): boolean;
}

interface IPv6Address extends Address {
  zone: string;
  isLinkLocal(): boolean;
  to4(): Address;
  group(): string;
  link(options?: { className?: string; prefix?: string }): string;
}

const ip = z
  .object({
    Address4: z.custom<new (text: string) => Address>((value) => typeof value === 'function'),
    Address6: z.custom<new (text: string) => IPv6Address>((value) => typeof value === 'function'),
    AddressError: z.custom<new (...args: string[]) => Error & { parseMessage?: string }>(
      (value) => typeof value === 'function'
    )
  })
  .parse(parentRequire('ip-address'));
const parent: unknown = sdkRequire('express-rate-limit');
if (typeof parent !== 'function' || !('ipKeyGenerator' in parent)) {
  throw new Error('Expected the rate limiter with its public ipKeyGenerator export');
}
const ipKeyGenerator = z
  .custom<
    (address: string, subnet?: number | false) => string
  >((value) => typeof value === 'function')
  .parse(parent.ipKeyGenerator);

type RateLimitConfig =
  | false
  | {
      windowMs: number;
      max: number;
      store: {
        localKeys: boolean;
        increment(key: string): { totalHits: number; resetTime: Date };
        decrement(key: string): void;
        resetKey(key: string): void;
      };
    };
const handlerPath = sdkRequire.resolve(
  '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js'
);
const { authorizationHandler } = z
  .object({
    authorizationHandler: z.custom<
      (options: { provider: object; rateLimit: RateLimitConfig }) => unknown
    >((value) => typeof value === 'function')
  })
  .parse(sdkRequire(handlerPath));
const express = z
  .custom<
    () => RequestListener & { use(handler: unknown): void }
  >((value) => typeof value === 'function')
  .parse(sdkRequire('express'));

function addressError(text: string): Error & { parseMessage?: string } {
  try {
    new ip.Address6(text);
  } catch (error) {
    if (error instanceof ip.AddressError) return error;
    throw error;
  }
  throw new Error('Expected Address6 to reject the fixture');
}

describe('ip-address through the installed SDK rate limiter', () => {
  it('resolves the same parent from the SDK entrypoint and authorization handler', () => {
    expect(createRequire(handlerPath).resolve('express-rate-limit')).toBe(parentPath);
    const manifest = z.object({ name: z.literal('ip-address') });
    expect(manifest.parse(parentRequire('ip-address/package.json')).name).toBe('ip-address');
    expect(path.dirname(leafPath)).toBe(
      path.join(path.dirname(parentRequire.resolve('ip-address/package.json')), 'dist')
    );
    const parentManifest = z.object({ name: z.literal('express-rate-limit') });
    expect(
      parentManifest.parse(
        JSON.parse(readFileSync(path.resolve(parentPath, '../../package.json'), 'utf8'))
      ).name
    ).toBe('express-rate-limit');
  });

  it('preserves ordinary IPv4, IPv6, subnet and mapped-address controls', () => {
    expect(new ip.Address4('10.0.0.1').correctForm()).toBe('10.0.0.1');
    expect(new ip.Address4('0.0.0.0').correctForm()).toBe('0.0.0.0');
    expect(new ip.Address4('10.0.0.1').isInSubnet(new ip.Address4('10.0.0.0/8'))).toBe(true);
    expect(new ip.Address6('2001:db8::1').isInSubnet(new ip.Address6('2001:db8::/32'))).toBe(true);
    expect(new ip.Address6('::ffff:10.0.0.1').to4().isInSubnet(new ip.Address4('10.0.0.0/8'))).toBe(
      true
    );
    expect(new ip.Address6('ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255/128').correctForm()).toBe(
      'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'
    );
  });

  it('rejects ambiguous leading-zero IPv4 literals', () => {
    expect(() => new ip.Address4('010.0.0.1')).toThrow(ip.AddressError);
  });

  it.each<[string, boolean]>([
    ['fe7f::1', false],
    ['fe80::1', true],
    ['fe90::1', true],
    ['febf::1', true],
    ['fec0::1', false]
  ])('classifies the IPv6 link-local boundary %s', (text, expected) => {
    expect(new ip.Address6(text).isLinkLocal()).toBe(expected);
  });

  it('rejects subnet containment across address families', () => {
    expect(new ip.Address6('a00::1').isInSubnet(new ip.Address4('10.0.0.0/8'))).toBe(false);
    expect(new ip.Address4('10.0.0.1').isInSubnet(new ip.Address6('a00::/8'))).toBe(false);
  });

  it('bounds invalid-address diagnostics before generating HTML', () => {
    const error = addressError('!'.repeat(46));
    expect(error.message).toMatch(/at most 45 characters/);
    expect(error.message.length).toBeLessThan(100);
    expect(error.parseMessage).toBeUndefined();
  });

  it('omits zone data from non-rendered grouped HTML', () => {
    const ordinary = new ip.Address6('fe80::1').group();
    expect(ordinary).toContain('<span');
    expect(new ip.Address6('fe80::1%<img>').group()).toBe(ordinary);
  });

  it('escapes link attributes without changing ordinary links', () => {
    const address = new ip.Address6('fe80::1');
    expect(address.link({ className: 'plain' })).toBe(
      '<a href="/#address=fe80::1" class="plain">fe80::1</a>'
    );
    const fragment = address.link({ className: 'x" data-probe="1' });
    expect(fragment).toContain('class="x&quot; data-probe=&quot;1"');
    expect(fragment).not.toContain('" data-probe="');
  });

  it('escapes an invalid mixed-address prefix in diagnostic HTML', () => {
    const error = addressError('<img>:10.0.01.1');
    expect(error.parseMessage).toContain('&lt;img&gt;');
    expect(error.parseMessage).not.toContain('<img>');
  });

  it('preserves ordinary zone syntax and rejects embedded line terminators', () => {
    expect(new ip.Address6('fe80::1%a%b').zone).toBe('%a%b');
    expect(new ip.Address6('fe80::1%').zone).toBe('%');
    for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
      expect(() => new ip.Address6(`fe80::1%a${terminator}b%c`)).toThrow(ip.AddressError);
    }
    expect(() => new ip.Address6(`fe80::1%${'%'.repeat(16)}\n`)).toThrow(ip.AddressError);
  });

  it('preserves the actual parent IPv4, mapped and IPv6 key generation', () => {
    expect(ipKeyGenerator('192.0.2.1')).toBe('192.0.2.1');
    expect(ipKeyGenerator('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(ipKeyGenerator('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd:1200::/56');
    expect(ipKeyGenerator('2001:db8:abcd:1234::1', 64)).toBe('2001:db8:abcd:1234::/64');
    expect(ipKeyGenerator('2001:db8:abcd:1234::1', false)).toBe('2001:db8:abcd:1234::1');
  });
});

// SDK consumer compatibility: CBC does not import this authorization branch.
describe('SDK authorizationHandler rate-limit compatibility', () => {
  it.each([true, false])(
    'handles two invalid requests with rate limiting enabled=%s',
    async (enabled) => {
      const getClient = vi.fn(() => {
        throw new Error('Provider must remain inert');
      });
      let hits = 0;
      const keys: string[] = [];
      const store = {
        localKeys: true,
        increment(key: string) {
          keys.push(key);
          return { totalHits: ++hits, resetTime: new Date('2099-01-01T00:00:00Z') };
        },
        decrement(_key: string) {
          throw new Error('Unexpected store decrement');
        },
        resetKey(_key: string) {
          throw new Error('Unexpected store reset');
        }
      };
      const app = express();
      app.use(
        authorizationHandler({
          provider: { clientsStore: { getClient } },
          rateLimit: enabled ? { windowMs: 60000, max: 1, store } : false
        })
      );
      const server = createServer(app);
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Expected an owned TCP listener');
        for (let index = 0; index < 2; index++) {
          const response = await new Promise<{
            status: number | undefined;
            headers: import('node:http').IncomingHttpHeaders;
            body: unknown;
          }>((resolve, reject) => {
            const request = get(
              { hostname: '127.0.0.1', port: address.port, path: '/', agent: false },
              (incoming) => {
                let body = '';
                incoming.setEncoding('utf8');
                incoming.on('data', (chunk: string) => {
                  body += chunk;
                });
                incoming.on('error', reject);
                incoming.on('end', () => {
                  try {
                    resolve({
                      status: incoming.statusCode,
                      headers: incoming.headers,
                      body: JSON.parse(body)
                    });
                  } catch (error) {
                    reject(error);
                  }
                });
              }
            );
            request.on('error', reject);
            request.setTimeout(2000, () =>
              request.destroy(new Error('Loopback request timed out'))
            );
          });
          const limited = enabled && index === 1;
          expect(response.status).toBe(limited ? 429 : 400);
          expect(response.body).toMatchObject({
            error: limited ? 'too_many_requests' : 'invalid_request'
          });
          if (enabled) {
            expect(response.headers['ratelimit-limit']).toBe('1');
            expect(response.headers['ratelimit-remaining']).toBe('0');
            expect(response.headers['ratelimit-reset']).toMatch(/^\d+$/);
            expect(response.headers['x-ratelimit-limit']).toBeUndefined();
          }
          if (limited) {
            expect(response.body).toMatchObject({
              error_description: 'You have exceeded the rate limit for authorization requests'
            });
          }
        }
        expect(getClient).not.toHaveBeenCalled();
        expect(hits).toBe(enabled ? 2 : 0);
        expect(keys).toEqual(enabled ? ['127.0.0.1', '127.0.0.1'] : []);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
        expect(server.listening).toBe(false);
      }
    }
  );
});
