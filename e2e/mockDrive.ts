/**
 * In-memory Google Drive + GIS auth mock for Playwright. One MiniDrive shared
 * by several browser contexts simulates several devices syncing through the
 * same account.
 */
import type { BrowserContext } from '@playwright/test';

interface MockFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: Buffer;
  rev: number;
  appProperties?: Record<string, string>;
}

export class MiniDrive {
  files = new Map<string, MockFile>();
  private counter = 0;

  newId(): string {
    return `f${++this.counter}`;
  }

  meta(f: MockFile) {
    return {
      id: f.id,
      name: f.name,
      modifiedTime: new Date(1700000000000 + f.rev).toISOString(),
      headRevisionId: String(f.rev),
    };
  }

  list(q: string): MockFile[] {
    const name = /name = '([^']+)'/.exec(q)?.[1];
    const parent = /'([^']+)' in parents/.exec(q)?.[1];
    const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
    return [...this.files.values()].filter(
      (f) =>
        (!name || f.name === name) &&
        (!parent || f.parents.includes(parent)) &&
        (!mime || f.mimeType === mime),
    );
  }
}

function parseMultipart(body: Buffer, contentType: string): {
  metadata: Record<string, unknown>;
  content: Buffer;
} {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? '';
  const sep = Buffer.from(`--${boundary}`);
  // Split into parts on the boundary.
  const parts: Buffer[] = [];
  let idx = body.indexOf(sep);
  while (idx !== -1) {
    const next = body.indexOf(sep, idx + sep.length);
    if (next === -1) break;
    parts.push(body.subarray(idx + sep.length, next));
    idx = next;
  }
  const stripPart = (part: Buffer): Buffer => {
    const headerEnd = part.indexOf('\r\n\r\n');
    let data = part.subarray(headerEnd + 4);
    // trim trailing \r\n
    if (data[data.length - 1] === 0x0a && data[data.length - 2] === 0x0d) {
      data = data.subarray(0, data.length - 2);
    }
    return data;
  };
  const metadata = JSON.parse(stripPart(parts[0]!).toString('utf8')) as Record<string, unknown>;
  const content = stripPart(parts[1]!);
  return { metadata, content };
}

const GSI_STUB = `
window.google = { accounts: { oauth2: {
  initTokenClient: function (cfg) {
    return {
      callback: cfg.callback,
      requestAccessToken: function () {
        var self = this;
        setTimeout(function () {
          self.callback({ access_token: 'mock-token', expires_in: 3600 });
        }, 20);
      },
    };
  },
  revoke: function (_t, cb) { if (cb) cb(); },
}}};
`;

export async function installMockDrive(
  context: BrowserContext,
  drive: MiniDrive,
): Promise<void> {
  await context.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: GSI_STUB }),
  );

  await context.route('https://www.googleapis.com/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // about
    if (path === '/drive/v3/about') {
      return json({ user: { emailAddress: 'mock@example.com', displayName: 'Mock User' } });
    }

    // uploads (create / update)
    if (path.startsWith('/upload/drive/v3/files')) {
      const body = req.postDataBuffer();
      if (!body) return json({ error: 'no body' }, 400);
      const { metadata, content } = parseMultipart(
        body,
        req.headers()['content-type'] ?? '',
      );
      const existingId = path.split('/')[5]; // /upload/drive/v3/files/<id>
      if (existingId && drive.files.has(existingId)) {
        const f = drive.files.get(existingId)!;
        f.content = content;
        f.rev += 1;
        if (typeof metadata.name === 'string') f.name = metadata.name;
        return json(drive.meta(f));
      }
      const f: MockFile = {
        id: drive.newId(),
        name: String(metadata.name ?? 'untitled'),
        mimeType: 'application/octet-stream',
        parents: Array.isArray(metadata.parents) ? (metadata.parents as string[]) : [],
        content,
        rev: 1,
        ...(metadata.appProperties
          ? { appProperties: metadata.appProperties as Record<string, string> }
          : {}),
      };
      drive.files.set(f.id, f);
      return json(drive.meta(f));
    }

    // files collection
    if (path === '/drive/v3/files') {
      if (req.method() === 'POST') {
        // folder create
        const meta = JSON.parse(req.postData() ?? '{}') as {
          name?: string;
          mimeType?: string;
          parents?: string[];
        };
        const f: MockFile = {
          id: drive.newId(),
          name: meta.name ?? 'folder',
          mimeType: meta.mimeType ?? 'application/octet-stream',
          parents: meta.parents ?? [],
          content: Buffer.alloc(0),
          rev: 1,
        };
        drive.files.set(f.id, f);
        return json({ id: f.id, ...drive.meta(f) });
      }
      const q = decodeURIComponent(url.searchParams.get('q') ?? '');
      return json({ files: drive.list(q).map((f) => drive.meta(f)) });
    }

    // single file: download / metadata
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (fileMatch) {
      const f = drive.files.get(fileMatch[1]!);
      if (!f) return json({ error: 'not found' }, 404);
      if (url.searchParams.get('alt') === 'media') {
        return route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: f.content,
        });
      }
      return json({ id: f.id, trashed: false, ...drive.meta(f) });
    }

    return json({ error: `unhandled ${path}` }, 500);
  });
}
