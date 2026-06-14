import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to control NODE_ENV before the module is imported.
// The Logger class reads process.env.NODE_ENV in its constructor, so
// we set up module-level mocks via vi.stubEnv.

describe('Logger (development mode)', () => {
  let logger: typeof import('../logger').logger;
  let createLogger: typeof import('../logger').createLogger;

  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const mod = await import('../logger');
    logger = mod.logger;
    createLogger = mod.createLogger;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should call console.debug for debug level in dev', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('test debug message');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should call console.info for info level in dev', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('test info message');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should call console.warn for warn level in dev', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('test warn message');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should call console.error for error level in dev', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('test error message');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should format message without context when called with one arg', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('hello world');
    expect(spy).toHaveBeenCalledWith(' hello world', '');
  });

  it('should format message with context when called with two string args', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('MyContext', 'context message');
    expect(spy).toHaveBeenCalledWith('[MyContext] context message', '');
  });

  it('should pass data as second arg to console when provided', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const data = { key: 'value' };
    logger.info('msg', data);
    expect(spy).toHaveBeenCalledWith(' msg', data);
  });

  it('should pass data as third arg when context + message + data', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const data = { x: 1 };
    logger.debug('Ctx', 'msg', data);
    expect(spy).toHaveBeenCalledWith('[Ctx] msg', data);
  });

  it('debug: treats second string arg as message (context overload)', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('ContextName', 'the message');
    const call = spy.mock.calls[0];
    expect(call[0]).toBe('[ContextName] the message');
  });

  it('warn: two-string overload uses context prefix', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('WarnCtx', 'warn msg');
    expect(spy).toHaveBeenCalledWith('[WarnCtx] warn msg', '');
  });

  it('error: two-string overload uses context prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('ErrCtx', 'error msg');
    expect(spy).toHaveBeenCalledWith('[ErrCtx] error msg', '');
  });

  it('error: passes error object as data', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    logger.error('something failed', err);
    expect(spy).toHaveBeenCalledWith(' something failed', err);
  });

  describe('createLogger factory', () => {
    it('should return an object with debug/info/warn/error methods', () => {
      const scoped = createLogger('TestService');
      expect(typeof scoped.debug).toBe('function');
      expect(typeof scoped.info).toBe('function');
      expect(typeof scoped.warn).toBe('function');
      expect(typeof scoped.error).toBe('function');
    });

    it('should prefix all calls with the given context', () => {
      const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const scoped = createLogger('ApiService');
      scoped.info('request sent');
      expect(spy).toHaveBeenCalledWith('[ApiService] request sent', '');
    });

    it('should forward data correctly through createLogger.debug', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const scoped = createLogger('DbService');
      scoped.debug('query', { sql: 'SELECT 1' });
      expect(spy).toHaveBeenCalledWith('[DbService] query', {
        sql: 'SELECT 1',
      });
    });

    it('should forward error through createLogger.error', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const scoped = createLogger('AuthService');
      const err = new Error('unauthorized');
      scoped.error('auth failed', err);
      expect(spy).toHaveBeenCalledWith('[AuthService] auth failed', err);
    });
  });
});

describe('Logger (production mode)', () => {
  let logger: typeof import('../logger').logger;

  beforeEach(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const mod = await import('../logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('should NOT call console.debug in production', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('debug message');
    expect(spy).not.toHaveBeenCalled();
  });

  it('should NOT call console.info in production', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('info message');
    expect(spy).not.toHaveBeenCalled();
  });

  it('should still call console.warn in production', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warn in prod');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('should still call console.error in production', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('error in prod');
    expect(spy).toHaveBeenCalledOnce();
  });
});
