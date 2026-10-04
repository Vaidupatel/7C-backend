import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { Role } from '../generated/prisma/enums.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  role: Role;
  hospitalId: string;
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret: string;
  private readonly accessExpiry: string;
  private readonly maxFailedAttempts = 5;
  private readonly lockoutMinutes = 15;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is required');
    }
    this.accessSecret = secret;
    this.accessExpiry = this.configService.get<string>(
      'JWT_ACCESS_EXPIRY',
      '15m',
    );
  }

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: UserResponse; tokens: AuthTokens }> {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email.toLowerCase() },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check Postgres lockout (Security Check 28)
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      const remainingMinutes = Math.ceil(
        (user.lockedUntil.getTime() - now.getTime()) / 60000,
      );
      throw new UnauthorizedException(
        `Account is temporarily locked. Try again in ${remainingMinutes} minutes.`,
      );
    }

    // Argon2id verification
    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      const newFailedAttempts = user.failedLoginAttempts + 1;
      let lockedUntil: Date | null = null;

      if (newFailedAttempts >= this.maxFailedAttempts) {
        lockedUntil = new Date(now.getTime() + this.lockoutMinutes * 60000);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newFailedAttempts,
          lockedUntil,
        },
      });

      await this.auditService.log({
        userId: user.id,
        userRole: user.role,
        action: 'AUTH_LOGIN_FAILED',
        entityName: 'User',
        entityId: user.id,
        ipAddress,
        userAgent,
        details: { reason: 'Invalid password', attempt: newFailedAttempts },
      });

      throw new UnauthorizedException('Invalid email or password');
    }

    // Successful login: reset failed attempts
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });

    const tokens = await this.generateTokens(user);

    await this.auditService.log({
      userId: user.id,
      userRole: user.role,
      action: 'AUTH_LOGIN_SUCCESS',
      entityName: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        hospitalId: user.hospitalId,
        mustChangePassword: user.mustChangePassword,
      },
      tokens,
    };
  }

  async refreshToken(
    rawRefreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthTokens> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Security Check 25: Reuse Detection
    if (storedToken.revokedAt) {
      // Possible token theft! Revoke all tokens for this user session family
      await this.prisma.refreshToken.updateMany({
        where: { userId: storedToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.auditService.log({
        userId: storedToken.userId,
        userRole: storedToken.user.role,
        action: 'AUTH_REFRESH_TOKEN_REUSE_DETECTED',
        entityName: 'RefreshToken',
        entityId: storedToken.id,
        ipAddress,
        userAgent,
        details: { warning: 'All user sessions revoked due to token reuse' },
      });

      throw new UnauthorizedException(
        'Session revoked due to detected token reuse',
      );
    }

    // Check expiration
    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (!storedToken.user.active) {
      throw new UnauthorizedException('User account is inactive');
    }

    // Rotate refresh token
    const newRawToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = this.hashToken(newRawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenHash: newTokenHash,
        },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: storedToken.userId,
          tokenHash: newTokenHash,
          expiresAt,
        },
      }),
    ]);

    const newAccessToken = await this.generateAccessToken(storedToken.user);

    return {
      accessToken: newAccessToken,
      refreshToken: newRawToken,
    };
  }

  async logout(rawRefreshToken: string, userId?: string): Promise<void> {
    if (!rawRefreshToken) return;

    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (userId) {
      await this.auditService.log({
        userId,
        action: 'AUTH_LOGOUT',
        entityName: 'User',
        entityId: userId,
      });
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isMatch = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!isMatch) {
      throw new BadRequestException('Current password does not match');
    }

    const newPasswordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          temporaryPassword: false,
        },
      }),
      // Revoke all existing sessions on password change
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.log({
      userId,
      userRole: user.role,
      action: 'AUTH_PASSWORD_CHANGED',
      entityName: 'User',
      entityId: userId,
    });
  }

  async adminResetPassword(
    adminId: string,
    targetUserId: string,
    temporaryPassword: string,
  ): Promise<void> {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== Role.ADMIN) {
      throw new UnauthorizedException(
        'Only administrators can reset passwords',
      );
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const newPasswordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
    });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: {
          passwordHash: newPasswordHash,
          temporaryPassword: true,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: targetUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.auditService.log({
      userId: adminId,
      userRole: Role.ADMIN,
      action: 'AUTH_ADMIN_PASSWORD_RESET',
      entityName: 'User',
      entityId: targetUserId,
      details: { forcedPasswordChange: true },
    });
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    hospitalId: string;
  }): Promise<AuthTokens> {
    const accessToken = await this.generateAccessToken(user);

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  private async generateAccessToken(user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    hospitalId: string;
  }): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        hospitalId: user.hospitalId,
        name: user.name,
      },
      {
        secret: this.accessSecret,
        expiresIn: 900, // 15 minutes (Security check 25)
        algorithm: 'HS256',
      },
    );
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
