import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService, UserResponse } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto.js';
import { Public } from './decorators/public.decorator.js';
import { Roles } from './decorators/roles.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { RequestUser } from './decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;
  private readonly allowedOrigins: string[];

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.isProd = this.configService.get<string>('NODE_ENV') === 'production';
    const origins = this.configService.get<string>(
      'CORS_ORIGIN',
      'http://localhost:3000',
    );
    this.allowedOrigins = origins.split(',').map((o) => o.trim());
  }

  @Post('login')
  @Public()
  @Throttle({
    auth: { ttl: 60000, limit: process.env.NODE_ENV === 'test' ? 1000 : 5 },
  })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: UserResponse; accessToken: string }> {
    const { user, tokens } = await this.authService.login(
      loginDto,
      req.ip,
      req.headers['user-agent'],
    );

    // Security Checklist 20: httpOnly, Secure, SameSite refresh cookie
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      user,
      accessToken: tokens.accessToken,
    };
  }

  @Post('refresh')
  @Public()
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    this.verifyOrigin(req);

    const rawRefreshToken = req.cookies?.['refreshToken'] as string | undefined;
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const tokens = await this.authService.refreshToken(
      rawRefreshToken,
      req.ip,
      req.headers['user-agent'],
    );

    if (tokens.refreshToken) {
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: this.isProd,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }

    return {
      accessToken: tokens.accessToken,
    };
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    this.verifyOrigin(req);

    const rawRefreshToken = req.cookies?.['refreshToken'] as string | undefined;
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }

    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/api/auth',
    });

    return { message: 'Logged out successfully' };
  }

  @Get('me')
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR)
  getMe(@CurrentUser() user: RequestUser): RequestUser {
    return user;
  }

  @Post('change-password')
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(userId, dto);

    // Clear refresh cookie so client re-authenticates
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/api/auth',
    });

    return {
      message: 'Password changed successfully. Please log in again.',
    };
  }

  @Post('admin-reset-password')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async adminResetPassword(
    @CurrentUser('userId') adminId: string,
    @Body() dto: AdminResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.adminResetPassword(
      adminId,
      dto.userId,
      dto.temporaryPassword,
    );

    return {
      message:
        'Temporary password set. User will be prompted to change password upon next login.',
    };
  }

  // Security Check 20: Origin check on state-changing cookie-authenticated endpoints
  private verifyOrigin(req: Request): void {
    const origin = req.headers['origin'];
    if (origin && !this.allowedOrigins.includes(origin)) {
      throw new ForbiddenException('CSRF protection: Invalid request origin');
    }
  }
}
