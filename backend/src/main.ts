import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const prefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(prefix);
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3001').split(','),
    credentials: true,
  });
  const port = Number(process.env.PORT || 8000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`El Niño API listening on http://localhost:${port}/${prefix}`);
}

bootstrap();
