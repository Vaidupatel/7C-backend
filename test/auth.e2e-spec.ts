import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface LoginResponseBody {
  user: {
    id: string;
    email: string;
    role: string;
    hospitalId: string;
    mustChangePassword: boolean;
  };
  accessToken: string;
}

interface MessageResponseBody {
  message: string;
}

interface TokenResponseBody {
  accessToken: string;
}

interface UserResponseBody {
  email: string;
  role: string;
}

describe('Auth & RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Login Flow & Lockout (Security Check 28)', () => {
    it('rejects invalid password with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@7colour.com',
          password: 'WrongPassword123!',
        })
        .expect(401);

      const body = res.body as MessageResponseBody;
      expect(body.message).toContain('Invalid email or password');
    });

    it('successfully logs in with valid credentials, returns access token and sets httpOnly cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'doctor@7colour.com',
          password: 'Doctor@7Colour2026!',
        })
        .expect(200);

      const body = res.body as LoginResponseBody;
      expect(body.accessToken).toBeDefined();
      expect(body.user.email).toBe('doctor@7colour.com');
      expect(body.user.role).toBe('DOCTOR');

      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      expect(cookies.some((c: string) => c.includes('refreshToken='))).toBe(
        true,
      );
      expect(cookies.some((c: string) => c.includes('HttpOnly'))).toBe(true);
    });

    it('locks account after 5 consecutive failed attempts', async () => {
      const testEmail = 'mo@7colour.com';

      // Reset attempts first
      await prisma.user.update({
        where: { email: testEmail },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: testEmail, password: 'WrongPassword!' })
          .expect(401);
      }

      // 6th attempt should return locked account notice
      const lockedRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: testEmail, password: 'WrongPassword!' })
        .expect(401);

      const body = lockedRes.body as MessageResponseBody;
      expect(body.message).toContain('Account is temporarily locked');

      // Reset for subsequent tests
      await prisma.user.update({
        where: { email: testEmail },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    });
  });

  describe('Token Rotation & Reuse Detection (Security Check 25)', () => {
    it('rotates refresh token and returns new access token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'doctor@7colour.com',
          password: 'Doctor@7Colour2026!',
        })
        .expect(200);

      const cookieHeader = loginRes.headers[
        'set-cookie'
      ] as unknown as string[];
      const refreshCookie = cookieHeader.find((c: string) =>
        c.startsWith('refreshToken='),
      );
      expect(refreshCookie).toBeDefined();

      const refreshRes = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [refreshCookie!])
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      const body = refreshRes.body as TokenResponseBody;
      expect(body.accessToken).toBeDefined();
      const newCookies = refreshRes.headers[
        'set-cookie'
      ] as unknown as string[];
      expect(newCookies.some((c: string) => c.includes('refreshToken='))).toBe(
        true,
      );
    });

    it('detects refresh token reuse and revokes session', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'doctor@7colour.com',
          password: 'Doctor@7Colour2026!',
        })
        .expect(200);

      const cookieHeader = loginRes.headers[
        'set-cookie'
      ] as unknown as string[];
      const oldCookie = cookieHeader.find((c: string) =>
        c.startsWith('refreshToken='),
      );

      // First refresh succeeds (token rotated)
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [oldCookie!])
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      // Reusing the old rotated token must trigger reuse detection and return 401
      const reuseRes = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', [oldCookie!])
        .set('Origin', 'http://localhost:3000')
        .expect(401);

      const body = reuseRes.body as MessageResponseBody;
      expect(body.message).toContain('token reuse');
    });
  });

  describe('RBAC & Route Protection: 401 vs 403', () => {
    let doctorToken: string;
    let adminToken: string;

    beforeAll(async () => {
      const docLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'doctor@7colour.com',
          password: 'Doctor@7Colour2026!',
        });
      doctorToken = (docLogin.body as LoginResponseBody).accessToken;

      const adminLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@7colour.com',
          password: 'Admin@SevenColors2026!',
        });
      adminToken = (adminLogin.body as LoginResponseBody).accessToken;
    });

    it('returns 401 Unauthorized when no token is provided', async () => {
      await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    });

    it('returns 200 with current user when valid token is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${doctorToken}`)
        .expect(200);

      const body = res.body as UserResponseBody;
      expect(body.email).toBe('doctor@7colour.com');
      expect(body.role).toBe('DOCTOR');
    });

    it('returns 403 Forbidden when non-admin accesses admin endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/admin-reset-password')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          userId: '00000000-0000-0000-0000-000000000000',
          temporaryPassword: 'NewTempPass123!',
        })
        .expect(403);

      const body = res.body as MessageResponseBody;
      expect(body.message).toContain('not authorized');
    });

    it('allows admin to reset password and forces change', async () => {
      const receptionist = await prisma.user.findUnique({
        where: { email: 'reception@7colour.com' },
      });
      expect(receptionist).toBeDefined();

      await request(app.getHttpServer())
        .post('/api/auth/admin-reset-password')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: receptionist!.id,
          temporaryPassword: 'TempReceptionPass123!',
        })
        .expect(200);

      // Verify that user now has mustChangePassword = true
      const updatedUser = await prisma.user.findUnique({
        where: { email: 'reception@7colour.com' },
      });
      expect(updatedUser?.mustChangePassword).toBe(true);
      expect(updatedUser?.temporaryPassword).toBe(true);

      // Verify user can login with temporary password
      const tempLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'reception@7colour.com',
          password: 'TempReceptionPass123!',
        })
        .expect(200);

      const tempLoginBody = tempLogin.body as LoginResponseBody;
      expect(tempLoginBody.user.mustChangePassword).toBe(true);

      // Restore receptionist password for other tests
      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${tempLoginBody.accessToken}`)
        .send({
          currentPassword: 'TempReceptionPass123!',
          newPassword: 'Reception@7Colour2026!',
        })
        .expect(200);
    });
  });

  describe('Audit Logging Without PII (Security Check 35)', () => {
    it('creates audit entries without passwords or tokens', async () => {
      const auditRows = await prisma.auditLog.findMany({
        where: { action: { startsWith: 'AUTH_' } },
        orderBy: { timestamp: 'desc' },
        take: 5,
      });

      expect(auditRows.length).toBeGreaterThan(0);
      for (const row of auditRows) {
        expect(row.action).toBeDefined();
        if (row.details) {
          const detailsStr = JSON.stringify(row.details);
          expect(detailsStr).not.toContain('Doctor@7Colour2026!');
          expect(detailsStr).not.toContain('Admin@SevenColors2026!');
        }
      }
    });
  });
});
