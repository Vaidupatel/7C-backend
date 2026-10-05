import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestUser } from '../decorators/current-user.decorator.js';

/**
 * A9 fix: Guard that blocks users with mustChangePassword=true from
 * accessing any endpoint except /auth/me, /auth/change-password, /auth/logout.
 * Returns 403 PASSWORD_CHANGE_REQUIRED so the frontend can redirect.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  private static readonly EXEMPT_SUFFIXES = [
    '/auth/me',
    '/auth/change-password',
    '/auth/logout',
    '/auth/refresh',
  ];

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: RequestUser; url: string }>();

    const user = request.user;

    // If no user (public endpoint), skip
    if (!user) {
      return true;
    }

    // Check if the endpoint is exempt (normalize trailing slashes and query strings)
    const rawPath = (request.url || '').split('?')[0];
    const normalizedPath = rawPath.replace(/\/+$/, '');

    const isExempt = MustChangePasswordGuard.EXEMPT_SUFFIXES.some(
      (suffix) =>
        normalizedPath === suffix ||
        normalizedPath.endsWith(suffix) ||
        normalizedPath === `/api${suffix}`,
    );

    if (isExempt) {
      return true;
    }

    // Block if user must change password
    if (user.mustChangePassword) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'You must change your password before accessing this resource',
        error: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    return true;
  }
}
