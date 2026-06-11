/**
 * Google Identity Services token client wrapper.
 * Access tokens live only in memory (~1h); we renew silently on expiry/401.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GSI_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
  callback: (response: TokenResponse) => void;
}

interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, callback?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOauth2 } };
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'no-client-id' | 'popup-blocked' | 'needs-consent' | 'denied' | 'unavailable',
  ) {
    super(message);
  }
}

export function getClientId(): string | null {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  return id && id.trim().length > 0 ? id.trim() : null;
}

let token: { value: string; expiresAt: number } | null = null;
let gsiLoaded: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiLoaded) return gsiLoaded;
  gsiLoaded = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new AuthError('Could not load Google sign-in', 'unavailable'));
    document.head.appendChild(script);
  });
  return gsiLoaded;
}

async function ensureTokenClient(): Promise<TokenClient> {
  const clientId = getClientId();
  if (!clientId) throw new AuthError('No Google client ID configured', 'no-client-id');
  await loadGsi();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new AuthError('Google sign-in unavailable', 'unavailable');
  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => undefined, // replaced per request
    });
  }
  return tokenClient;
}

function requestToken(prompt: '' | 'consent'): Promise<string> {
  return new Promise((resolve, reject) => {
    void ensureTokenClient()
      .then((client) => {
        let settled = false;
        client.callback = (response) => {
          settled = true;
          if (response.access_token) {
            token = {
              value: response.access_token,
              expiresAt: Date.now() + ((response.expires_in ?? 3600) - 60) * 1000,
            };
            resolve(response.access_token);
          } else {
            reject(
              new AuthError(
                response.error ?? 'Authorization failed',
                response.error === 'access_denied' ? 'denied' : 'needs-consent',
              ),
            );
          }
        };
        // Popup-blocked / closed without response: GIS calls error_callback only
        // when configured at init; fall back to a timeout for silent requests.
        if (prompt === '') {
          setTimeout(() => {
            if (!settled) {
              reject(new AuthError('Silent token renewal timed out', 'needs-consent'));
            }
          }, 12000);
        }
        try {
          client.requestAccessToken({ prompt });
        } catch (err) {
          reject(
            new AuthError(
              err instanceof Error ? err.message : 'Popup blocked',
              'popup-blocked',
            ),
          );
        }
      })
      .catch(reject);
  });
}

/** Interactive connect (first time: consent screen). */
export function connectInteractive(): Promise<string> {
  return requestToken('consent');
}

/**
 * Valid access token: cached → silent renew → AuthError('needs-consent')
 * (callers should pause sync and surface a Reconnect button).
 */
export async function getAccessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  return requestToken('');
}

/** Drop the cached token so the next call must renew (after a 401). */
export function invalidateToken(): void {
  token = null;
}

export function revokeAndForget(): void {
  const current = token?.value;
  token = null;
  if (current) {
    window.google?.accounts?.oauth2?.revoke(current);
  }
}
