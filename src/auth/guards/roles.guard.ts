import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { Role } from '../../generated/prisma/enums.js';
import { RequestUser } from '../decorators/current-user.decorator.js';

/**
 * B1 fix: Default-deny roles guard.
 * - @Public() endpoints: skip role check
 * - Endpoints with @Roles(...): require one of the listed roles
 * - Endpoints without @Roles(): deny (require explicit role declaration)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Public endpoints skip role checks
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // B1: If no roles are declared and endpoint is not public, deny access
    if (!requiredRoles || requiredRoles.length === 0) {
      throw new ForbiddenException(
        'Access denied: no roles configured for this endpoint',
      );
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: RequestUser }>();

    if (!user) {
      throw new ForbiddenException('User context not found');
    }

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) {
      throw new ForbiddenException(
        'User is not authorized to access this resource',
      );
    }

    return true;
  }
}
