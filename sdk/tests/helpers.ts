/** Shared mock helpers for SDK tests */

export function mockReq(method: string, path: string, opts?: { body?: any; query?: Record<string, string>; headers?: Record<string, string>; ip?: string }): any {
  return {
    method,
    path,
    body: opts?.body ?? {},
    query: opts?.query ?? {},
    params: {},
    headers: opts?.headers ?? {},
    ip: opts?.ip ?? '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
}

export function mockRes(): any {
  const res: any = {
    _status: 200,
    _body: null,
    _headers: {} as Record<string, any>,
    headersSent: false,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._body = body; res.headersSent = true; return res; },
    send(body: any) { res._body = body; res.headersSent = true; return res; },
    type(t: string) { res._headers['content-type'] = t; return res; },
    setHeader(k: string, v: any) { res._headers[k.toLowerCase()] = v; return res; },
    getHeader(k: string) { return res._headers[k.toLowerCase()]; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}
