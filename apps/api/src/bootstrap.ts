import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { logger } from './common/logger';

export async function createApp(): Promise<INestApplication> {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger: ['error', 'warn'], bodyParser: true });
  app.set('trust proxy', cfg.TRUST_PROXY);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '12mb' });
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: cfg.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
      serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url?.split('?')[0] }), res: (r) => ({ statusCode: r.statusCode }) },
    }),
  );
  const origins = (cfg.CORS_ORIGINS ?? cfg.APP_URL).split(',').map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  app.setGlobalPrefix('api/v1');

  const doc = new DocumentBuilder()
    .setTitle(`${cfg.APP_NAME} API`)
    .setDescription(
      'REST API for JiMail. Organisation endpoints accept API keys (Authorization: Bearer jm_live_...) limited to the issuing organisation and to the scopes granted. Browser sessions use an HttpOnly cookie plus the X-CSRF-Token header on mutating requests.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Organisation API key (jm_live_...)' })
    .build();
  const document = SwaggerModule.createDocument(app, doc);
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/v1/openapi.json', swaggerOptions: { persistAuthorization: false } });
  return app;
}
