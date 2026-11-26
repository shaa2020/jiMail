import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { StalwartError } from '../modules/stalwart/stalwart.client';
import { logger } from './logger';

/** Uniform error responses; internals are logged, never leaked to clients. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      if (status >= 500) logger.error({ err: exception.message, path: req.url }, 'HTTP error');
      return res.status(status).json({ statusCode: status, ...payload });
    }
    if (exception instanceof StalwartError) {
      logger.warn({ err: exception.message, type: exception.type, path: req.url }, 'Mail server error');
      return res.status(HttpStatus.BAD_GATEWAY).json({ statusCode: 502, message: `Mail server: ${exception.message}` });
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') return res.status(409).json({ statusCode: 409, message: 'A record with these details already exists' });
      if (exception.code === 'P2025') return res.status(404).json({ statusCode: 404, message: 'Not found' });
    }
    logger.error({ err: (exception as Error)?.message, stack: (exception as Error)?.stack, path: req.url }, 'Unhandled error');
    return res.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
