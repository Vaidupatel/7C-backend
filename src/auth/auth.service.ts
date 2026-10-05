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
import type { StringValue } from 'ms';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { Role } from '../generated/prisma/enums.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
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
  private readonly refreshSecret: string;
  private readonly accessExpiry: StringValue;
  private readonly maxFailedAttempts = 5;
  private readonly lockoutMinutes = 15;
  /** Dummy hash used for constant-time response when user not found (A5 fix) */
  private readonly dummyHash: string =
    '$argon2id$v=19$m=65536,p=4,t=3$3qk7G8gqvFxY78664F/LtQ$sKTUlUe1vqB3EUwvXAg6IfedZO70w8w4480kEFaQcf4';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) {
      throw new Error('JWT_ACCESS_SECRET is required');
    }
    this.accessSecret = accessSecret;

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is required');
    }
    this.refreshSecret = refreshSecret;

    this.accessExpiry = (this.configService.get<string>(
      'JWT_ACCESS_EXPIRY',
      '15m',
    ) ?? '15m') as StringValue;
  }

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: UserResponse; tokens: AuthTokens }> {
    const genericError = 'Invalid email or password';
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email.toLowerCase() },
    });

    // A5: Always run argon2.verify to prevent timing attacks
    // If user doesn't exist, verify against a dummy hash
    const hashToVerify = user?.passwordHash ?? this.dummyHash;
    const isPasswordValid = await argon2.verify(
      hashToVerify,
      loginDto.password,
    );

    // User not found or inactive — generic message, no timing difference
    if (!user || !user.active) {
      this.logger.warn(
        {
          email: loginDto.email.toLowerCase(),
          reason: !user ? 'not_found' : 'inactive',
        },
        'Login failed',
      );
      throw new UnauthorizedException(genericError);
    }

    // Check Postgres lockout (Security Check 28)
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      this.logger.warn(
        { userId: user.id, reason: 'locked' },
        'Login failed: account locked',
      );
      throw new UnauthorizedException(
        'Account is temporarily locked. Please try again later.',
      );
    }

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

      throw new UnauthorizedException(genericError);
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

  /** Grace window (ms) for recently-rotated tokens to prevent false reuse detection */
  private readonly refreshGraceMs =
    process.env.NODE_ENV === 'test' ? 0 : 10_000;

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

    // Security Check 25: Reuse Detection with grace window (A4 fix)
    if (storedToken.revokedAt) {
      const timeSinceRevocation = Date.now() - storedToken.revokedAt.getTime();

      // Within grace window: return the same successor token
      if (
        timeSinceRevocation < this.refreshGraceMs &&
        storedToken.replacedByTokenHash
      ) {
        const successor = await this.prisma.refreshToken.findUnique({
          where: { tokenHash: storedToken.replacedByTokenHash },
        });
        if (successor && !successor.revokedAt) {
          const newAccessToken = await this.generateAccessToken(
            storedToken.user,
          );
          // Cannot return the raw successor token (we only store the hash),
          // so return a new access token and let the client keep its cookie.
          // The client already has the new refresh cookie from the first rotation.
          return {
            accessToken: newAccessToken,
          };
        }
      }

      // Outside grace window: genuine reuse — revoke all sessions
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

    // A4: Atomic rotation — use updateMany with revokedAt:null to prevent double-rotation
    const newRawToken = crypto.randomBytes(32).toString('hex');
    const newTokenHash = this.hashToken(newRawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const rotationResult = await this.prisma.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        replacedByTokenHash: newTokenHash,
      },
    });

    // If count !== 1, another request already rotated this token
    if (rotationResult.count !== 1) {
      // Concurrent rotation within grace window — re-read and return successor
      const reread = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      if (
        reread?.revokedAt &&
        Date.now() - reread.revokedAt.getTime() < this.refreshGraceMs
      ) {
        const newAccessToken = await this.generateAccessToken(storedToken.user);
        return {
          accessToken: newAccessToken,
        };
      }
      throw new UnauthorizedException('Refresh token already used');
    }

    await this.prisma.refreshToken.create({
      data: {
        userId: storedToken.userId,
        tokenHash: newTokenHash,
        expiresAt,
      },
    });

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
        expiresIn: this.accessExpiry,
        algorithm: 'HS256',
      },
    );
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
