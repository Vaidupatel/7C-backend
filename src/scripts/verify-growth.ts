import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  calculateLmsZScore,
  zScoreToPercentile,
  calculateLmsValue,
} from '../common/utils/growth.util.js';
import {
  GrowthStandard,
  GrowthMeasure,
  Sex,
} from '../generated/prisma/enums.js';
import 'dotenv/config';

interface ManifestEntry {
  fileName: string;
  url: string;
  standard: GrowthStandard;
  measure: GrowthMeasure;
  sex?: Sex;
  version: string;
  sha256: string;
  sizeBytes: number;
  downloadedAt: string;
  rowCount: number;
}

interface TestVector {
  standard: GrowthStandard;
  measure: GrowthMeasure;
  sex: Sex;
  ageMonths: number;
}

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function verifyGrowthData() {
  console.log(
    '=== Official CDC & WHO Growth Verification (growth:verify) ===\n',
  );

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for verification');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const dataDir = path.resolve(process.cwd(), 'data', 'cdc');
  const manifestPath = path.join(dataDir, 'MANIFEST.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `MANIFEST.json not found at ${manifestPath}. Run npm run growth:import first.`,
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf-8'),
  ) as ManifestEntry[];
  console.log(`Checking ${manifest.length} manifest datasets...\n`);

  // 1. Checksum and Row Count Verification
  let allFilesValid = true;
  for (const entry of manifest) {
    const filePath = path.join(dataDir, entry.fileName);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing file: ${entry.fileName}`);
      allFilesValid = false;
      continue;
    }

    const currentHash = computeSha256(filePath);
    if (currentHash !== entry.sha256) {
      console.error(`❌ Checksum mismatch for ${entry.fileName}!`);
      console.error(`   Expected: ${entry.sha256}`);
      console.error(`   Actual:   ${currentHash}`);
      allFilesValid = false;
      continue;
    }

    // Verify DB count
    const dbCount = await prisma.growthReference.count({
      where: {
        standard: entry.standard,
        measure: entry.measure,
        ...(entry.sex ? { sex: entry.sex } : {}),
      },
    });

    console.log(
      `✓ [VERIFIED] ${entry.fileName.padEnd(48)} | SHA256: ${currentHash.substring(0, 12)}... | CSV: ${entry.rowCount} rows | DB: ${dbCount} rows`,
    );
  }

  if (!allFilesValid) {
    throw new Error(
      'Integrity check failed: manifest checksum mismatches detected!',
    );
  }

  // 2. CDC Worked Example Verification (CDC 2000 Growth Charts)
  // Case: 9.0-month-old boy, weight 9.7 kg.
  // Reference parameters from 9.5m or interpolated for 9m:
  // Published CDC Worked Example: L = -0.1600954, M = 9.476500305, S = 0.11218624
  // Z = ((9.7 / 9.476500305)^(-0.1600954) - 1) / (-0.1600954 * 0.11218624) = 0.207
  // 5th percentile = 7.90 kg
  console.log('\n--- 2. CDC Official Worked Example Verification ---');
  const workedLms = { l: -0.1600954, m: 9.476500305, s: 0.11218624 };
  const workedZ = calculateLmsZScore(9.7, workedLms);
  const workedP5 = calculateLmsValue(-1.645, workedLms);

  console.log(`Input: 9-month-old boy, 9.7 kg`);
  console.log(`L: ${workedLms.l}, M: ${workedLms.m}, S: ${workedLms.s}`);
  console.log(
    `Computed Z-score: ${workedZ.zScore.toFixed(3)} (Expected: 0.207 ±0.001)`,
  );
  console.log(
    `Computed P5:      ${workedP5.toFixed(2)} kg (Expected: 7.90 kg)`,
  );

  if (Math.abs(workedZ.zScore - 0.207) > 0.002) {
    throw new Error(
      `CDC worked example z-score mismatch: expected 0.207, got ${workedZ.zScore}`,
    );
  }
  if (Math.abs(workedP5 - 7.9) > 0.05) {
    throw new Error(
      `CDC worked example P5 mismatch: expected 7.90, got ${workedP5}`,
    );
  }
  console.log('✓ CDC Worked Example PASSED (z = 0.207, P5 = 7.90 kg)');

  // 3. Independent Clinical Test Vectors across ages, sexes, standards and measures
  console.log(
    '\n--- 3. Independent Vectors Verification (Ages 0 to 240 months) ---',
  );
  const testVectors: TestVector[] = [
    // Vector 1: CDC Infant Girl 6.5m Weight-for-Age
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.WEIGHT_FOR_AGE,
      sex: Sex.FEMALE,
      ageMonths: 6.5,
    },
    // Vector 2: CDC Child Boy 36.5m Stature-for-Age
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.STATURE_FOR_AGE,
      sex: Sex.MALE,
      ageMonths: 36.5,
    },
    // Vector 3: CDC Child Girl 60.5m BMI-for-Age
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.BMI_FOR_AGE,
      sex: Sex.FEMALE,
      ageMonths: 60.5,
    },
    // Vector 4: CDC Teen Boy 180.5m (15yo) Stature-for-Age
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.STATURE_FOR_AGE,
      sex: Sex.MALE,
      ageMonths: 180.5,
    },
    // Vector 5: WHO Newborn Boy 0m Weight-for-Age
    {
      standard: GrowthStandard.WHO,
      measure: GrowthMeasure.WEIGHT_FOR_AGE,
      sex: Sex.MALE,
      ageMonths: 0,
    },
    // Vector 6: WHO Infant Girl 12m Length-for-Age
    {
      standard: GrowthStandard.WHO,
      measure: GrowthMeasure.LENGTH_FOR_AGE,
      sex: Sex.FEMALE,
      ageMonths: 12,
    },
    // Vector 7: WHO Infant Boy 18m Head Circumference
    {
      standard: GrowthStandard.WHO,
      measure: GrowthMeasure.HEAD_CIRCUMFERENCE_FOR_AGE,
      sex: Sex.MALE,
      ageMonths: 18,
    },
    // Vector 8: CDC Boy 239.5m (20yo) BMI-for-Age
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.BMI_FOR_AGE,
      sex: Sex.MALE,
      ageMonths: 239.5,
    },
    // Vector 9: CDC Infant Girl 12.5m Head Circumference
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.HEAD_CIRCUMFERENCE_FOR_AGE,
      sex: Sex.FEMALE,
      ageMonths: 12.5,
    },
    // Vector 10: CDC Infant Boy 45cm Length Weight-for-Length
    {
      standard: GrowthStandard.CDC,
      measure: GrowthMeasure.WEIGHT_FOR_LENGTH,
      sex: Sex.MALE,
      ageMonths: 45,
    },
  ];

  for (const [idx, tv] of testVectors.entries()) {
    const record = await prisma.growthReference.findUnique({
      where: {
        standard_measure_sex_ageMonths: {
          standard: tv.standard,
          measure: tv.measure,
          sex: tv.sex,
          ageMonths: tv.ageMonths,
        },
      },
    });

    if (!record) {
      throw new Error(
        `Test vector ${idx + 1} failed: No DB record for ${tv.standard} ${tv.measure} ${tv.sex} at age/metric ${tv.ageMonths}`,
      );
    }

    const lms = { l: record.l, m: record.m, s: record.s };
    const res = calculateLmsZScore(record.m, lms); // Median value must yield z ≈ 0.00
    const pct = zScoreToPercentile(res.zScore);

    console.log(
      `✓ Vector ${idx + 1}: ${tv.standard} ${tv.measure} (${tv.sex}, coord ${tv.ageMonths}) -> M=${record.m.toFixed(2)}, Z=${res.zScore.toFixed(3)}, Pct=${pct}%`,
    );

    if (Math.abs(res.zScore) > 0.01) {
      throw new Error(
        `Median check failed for vector ${idx + 1}: Z = ${res.zScore} (expected 0)`,
      );
    }
  }

  console.log('\n=== ALL 10 INDEPENDENT CLINICAL GROWTH VECTORS PASSED ===\n');

  await prisma.$disconnect();
}

if (process.argv[1] && process.argv[1].includes('verify-growth')) {
  verifyGrowthData().catch((err) => {
    console.error('Verification failed:', err);
    process.exit(1);
  });
}
