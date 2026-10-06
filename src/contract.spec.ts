import * as fs from 'fs';
import * as path from 'path';

describe('Frontend <-> Backend Route Contract', () => {
  const backendRouteTable = [
    // Health
    { method: 'GET', path: '/api/health' },
    // Auth
    { method: 'POST', path: '/api/auth/login' },
    { method: 'POST', path: '/api/auth/refresh' },
    { method: 'POST', path: '/api/auth/logout' },
    { method: 'GET', path: '/api/auth/me' },
    { method: 'POST', path: '/api/auth/change-password' },
    // Reception
    { method: 'GET', path: '/api/reception/patients/search' },
    { method: 'GET', path: '/api/reception/patients/:id' },
    { method: 'POST', path: '/api/reception/patients' },
    { method: 'POST', path: '/api/reception/visits' },
    { method: 'GET', path: '/api/reception/today-visits' },
    // Vitals & Catalog
    { method: 'GET', path: '/api/vitals/queue' },
    { method: 'POST', path: '/api/vitals' },
    { method: 'GET', path: '/api/catalog/complaints' },
    { method: 'GET', path: '/api/catalog/signs' },
    { method: 'POST', path: '/api/catalog/signs' },
    { method: 'POST', path: '/api/catalog/sign-proposals' },
    { method: 'GET', path: '/api/catalog/sign-proposals' },
    { method: 'PATCH', path: '/api/catalog/signs/:id' },
    { method: 'DELETE', path: '/api/catalog/signs/:id' },
    // Doctor & Growth
    { method: 'GET', path: '/api/doctor/queue' },
    { method: 'POST', path: '/api/doctor/triage/override' },
    { method: 'GET', path: '/api/doctor/patients/:id' },
    { method: 'PATCH', path: '/api/doctor/visits/:id/status' },
    { method: 'GET', path: '/api/growth/chart-curves' },
    { method: 'POST', path: '/api/growth/evaluate' },
    { method: 'GET', path: '/api/growth/lms' },
    // Audit
    { method: 'GET', path: '/api/audit' },
  ];

  it('all frontend API route strings should exist in backend route table', () => {
    const feApiPath = path.resolve(__dirname, '../../frontend/store/api');
    if (!fs.existsSync(feApiPath)) {
      // In isolated backend container / test
      return;
    }

    const files = fs
      .readdirSync(feApiPath)
      .filter((f) => f.endsWith('.ts') && f !== 'apiSlice.ts');
    const extractedPaths: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(feApiPath, file), 'utf-8');
      const matches = content.matchAll(
        /['"`](\/(?:doctor|growth|reception|vitals|catalog|audit|auth)\/[a-zA-Z0-9_\-${}?=/&]+)['"`]/g,
      );
      for (const m of matches) {
        let route = m[1];
        if (route.includes('?')) {
          route = route.split('?')[0];
        }
        route = route.replace(/\$\{[^}]+\}/g, ':id');
        const fullRoute = `/api${route}`;
        if (!extractedPaths.includes(fullRoute)) {
          extractedPaths.push(fullRoute);
        }
      }
    }

    const backendPaths = backendRouteTable.map((r) => r.path);

    for (const feRoute of extractedPaths) {
      const matched = backendPaths.some((bp) => {
        if (bp === feRoute) return true;
        const bpRegex = new RegExp(
          '^' + bp.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$',
        );
        return bpRegex.test(feRoute);
      });
      expect({ route: feRoute, valid: matched }).toEqual({
        route: feRoute,
        valid: true,
      });
    }
  });

  it('no obsolete /growth/curves exists in frontend', () => {
    const feApiPath = path.resolve(__dirname, '../../frontend/store/api');
    if (!fs.existsSync(feApiPath)) return;
    const content = fs.readFileSync(
      path.join(feApiPath, 'doctorApi.ts'),
      'utf-8',
    );
    expect(content.includes('/growth/curves')).toBe(false);
    expect(content.includes('/growth/chart-curves')).toBe(true);
  });
});
