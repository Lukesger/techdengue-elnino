import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Auth mínima para o monorepo local.
 * Aceita Bearer token; se ELNINO_DEMO_AUTH=true, injeta usuário global demo sem validar JWT real.
 */
@Injectable()
export class DemoAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: Record<string, unknown>;
    }>();

    const demo =
      String(process.env.ELNINO_DEMO_AUTH || 'true').toLowerCase() === 'true';

    const auth = req.headers.authorization || '';
    const hasBearer =
      auth.toLowerCase().startsWith('bearer ') && auth.trim().length > 10;

    if (!hasBearer && !demo) {
      throw new UnauthorizedException('Token não fornecido');
    }

    req.user = {
      id: 1,
      email: 'elnino-demo@local',
      nome: 'El Niño Demo',
      isGlobal: true,
      permissoes: ['analytics:elnino:read', 'analytics:elnino:refresh'],
      perfil: { nome: 'admin' },
    };
    return true;
  }
}
