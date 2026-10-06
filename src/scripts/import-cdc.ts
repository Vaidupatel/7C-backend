import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

interface FileSpec {
  fileName: string;
  url: string;
  standard: 'CDC' | 'WHO';
  measure:
    | 'WEIGHT_FOR_AGE'
    | 'LENGTH_FOR_AGE'
    | 'STATURE_FOR_AGE'
    | 'HEAD_CIRCUMFERENCE_FOR_AGE'
    | 'BMI_FOR_AGE'
    | 'WEIGHT_FOR_LENGTH'
    | 'WEIGHT_FOR_STATURE';
  sex?: 'MALE' | 'FEMALE';
  version: string;
}

const FILES_TO_IMPORT: FileSpec[] = [
  // CDC LMS Files (2000 CDC Growth Charts)
  {
    fileName: 'wtageinf.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/wtageinf.csv',
    standard: 'CDC',
    measure: 'WEIGHT_FOR_AGE',
    version: '2000-05-30',
  },
  {
    fileName: 'lenageinf.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/lenageinf.csv',
    standard: 'CDC',
    measure: 'LENGTH_FOR_AGE',
    version: '2000-05-30',
  },
  {
    fileName: 'hcageinf.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/hcageinf.csv',
    standard: 'CDC',
    measure: 'HEAD_CIRCUMFERENCE_FOR_AGE',
    version: '2000-05-30',
  },
  {
    fileName: 'wtleninf.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/wtleninf.csv',
    standard: 'CDC',
    measure: 'WEIGHT_FOR_LENGTH',
    version: '2000-05-30',
  },
  {
    fileName: 'wtage.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/wtage.csv',
    standard: 'CDC',
    measure: 'WEIGHT_FOR_AGE',
    version: '2000-05-30',
  },
  {
    fileName: 'statage.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/statage.csv',
    standard: 'CDC',
    measure: 'STATURE_FOR_AGE',
    version: '2000-05-30',
  },
  {
    fileName: 'bmiagerev.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/bmiagerev.csv',
    standard: 'CDC',
    measure: 'BMI_FOR_AGE',
    version: '2000-05-30',
  },
  {
    fileName: 'wtstat.csv',
    url: 'https://www.cdc.gov/growthcharts/data/zscore/wtstat.csv',
    standard: 'CDC',
    measure: 'WEIGHT_FOR_STATURE',
    version: '2000-05-30',
  },
  // WHO Percentiles Files (2006 WHO Child Growth Standards)
  {
    fileName: 'WHO-Boys-Weight-for-age-Percentiles.csv',
    url: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Boys-Weight-for-age-Percentiles.csv',
    standard: 'WHO',
    measure: 'WEIGHT_FOR_AGE',
    sex: 'MALE',
    version: '2006-04-27',
  },
  {
    fileName: 'WHO-Girls-Weight-for-age-Percentiles.csv',
    url: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Girls-Weight-for-age%20Percentiles.csv',
    standard: 'WHO',
    measure: 'WEIGHT_FOR_AGE',
    sex: 'FEMALE',
    version: '2006-04-27',
  },
  {
    fileName: 'WHO-Boys-Length-for-age-Percentiles.csv',
    url: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Boys-Length-for-age-Percentiles.csv',
    standard: 'WHO',
    measure: 'LENGTH_FOR_AGE',
    sex: 'MALE',
    version: '2006-04-27',
  },
  {
    fileName: 'WHO-Girls-Length-for-age-Percentiles.csv',
    url: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Girls-Length-for-age-Percentiles.csv',
    standard: 'WHO',
    measure: 'LENGTH_FOR_AGE',
    sex: 'FEMALE',
    version: '2006-04-27',
  },
  {
    fileName: 'WHO-Boys-Head-Circumference-for-age-Percentiles.csv',
    url: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Boys-Head-Circumference-for-age-Percentiles.csv',
    standard: 'WHO',
    measure: 'HEAD_CIRCUMFERENCE_FOR_AGE',
    sex: 'MALE',
    version: '2006-04-27',
  },
  {
    fileName: 'WHO-Girls-Head-Circumference-for-age-Percentiles.csv',
    url: 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Girls-Head-Circumference-for-age-Percentiles.csv',
    standard: 'WHO',
    measure: 'HEAD_CIRCUMFERENCE_FOR_AGE',
    sex: 'FEMALE',
    version: '2006-04-27',
  },
];

async function downloadFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download ${url}: ${res.status} ${res.statusText}`,
    );
  }
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
}

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function importCdcData() {
  console.log('=== Official CDC & WHO Growth LMS Importer ===');

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for import');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  const dataDir = path.resolve(process.cwd(), 'data', 'cdc');
  fs.mkdirSync(dataDir, { recursive: true });

  const manifestEntries: Array<{
    fileName: string;
    url: string;
    standard: string;
    measure: string;
    sex?: string;
    version: string;
    sha256: string;
    sizeBytes: number;
    downloadedAt: string;
    rowCount: number;
  }> = [];

  let totalImported = 0;

  for (const spec of FILES_TO_IMPORT) {
    const filePath = path.join(dataDir, spec.fileName);

    // Download if file does not exist
    if (!fs.existsSync(filePath)) {
      console.log(`Downloading ${spec.fileName} from ${spec.url}...`);
      await downloadFile(spec.url, filePath);
    } else {
      console.log(`Using cached file ${spec.fileName}`);
    }

    const sha256 = computeSha256(filePath);
    const stats = fs.statSync(filePath);

    // Read and parse CSV
    const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\ufeff/, ''); // remove UTF-8 BOM
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      console.warn(`File ${spec.fileName} has no data rows, skipping.`);
      continue;
    }

    const header = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1);

    console.log(`Parsing ${rows.length} rows from ${spec.fileName}...`);
    let fileImported = 0;

    for (const rowLine of rows) {
      const parts = rowLine.split(',').map((p) => p.trim());
      if (parts.length < 4) continue;

      const rowObj: Record<string, string> = {};
      header.forEach((h, idx) => {
        rowObj[h] = parts[idx] ?? '';
      });

      // Determine Sex
      let sex: 'MALE' | 'FEMALE';
      if (spec.sex) {
        sex = spec.sex;
      } else {
        const rawSex = rowObj['Sex'];
        sex = rawSex === '2' ? 'FEMALE' : 'MALE';
      }

      // Determine Age or independent dimension
      const ageStr =
        rowObj['Agemos'] ??
        rowObj['Length'] ??
        rowObj['Height'] ??
        rowObj['Month'] ??
        parts[1];
      const ageMonths = parseFloat(ageStr);
      if (isNaN(ageMonths)) continue;

      const l = parseFloat(rowObj['L'] ?? parts[2]);
      const m = parseFloat(rowObj['M'] ?? parts[3]);
      const s = parseFloat(rowObj['S'] ?? parts[4]);
      if (isNaN(l) || isNaN(m) || isNaN(s)) continue;

      const p3 = rowObj['P3']
        ? parseFloat(rowObj['P3'])
        : rowObj['2nd (2.3rd)']
          ? parseFloat(rowObj['2nd (2.3rd)'])
          : null;
      const p5 = rowObj['P5']
        ? parseFloat(rowObj['P5'])
        : rowObj['5th']
          ? parseFloat(rowObj['5th'])
          : null;
      const p10 = rowObj['P10']
        ? parseFloat(rowObj['P10'])
        : rowObj['10th']
          ? parseFloat(rowObj['10th'])
          : null;
      const p25 = rowObj['P25']
        ? parseFloat(rowObj['P25'])
        : rowObj['25th']
          ? parseFloat(rowObj['25th'])
          : null;
      const p50 = rowObj['P50']
        ? parseFloat(rowObj['P50'])
        : rowObj['50th']
          ? parseFloat(rowObj['50th'])
          : null;
      const p75 = rowObj['P75']
        ? parseFloat(rowObj['P75'])
        : rowObj['75th']
          ? parseFloat(rowObj['75th'])
          : null;
      const p85 = rowObj['P85'] ? parseFloat(rowObj['P85']) : null;
      const p90 = rowObj['P90']
        ? parseFloat(rowObj['P90'])
        : rowObj['90th']
          ? parseFloat(rowObj['90th'])
          : null;
      const p95 = rowObj['P95']
        ? parseFloat(rowObj['P95'])
        : rowObj['95th']
          ? parseFloat(rowObj['95th'])
          : null;
      const p97 = rowObj['P97']
        ? parseFloat(rowObj['P97'])
        : rowObj['98th (97.7th)']
          ? parseFloat(rowObj['98th (97.7th)'])
          : null;

      await prisma.growthReference.upsert({
        where: {
          standard_measure_sex_ageMonths: {
            standard: spec.standard,
            measure: spec.measure,
            sex,
            ageMonths,
          },
        },
        update: {
          l,
          m,
          s,
          p3,
          p5,
          p10,
          p25,
          p50,
          p75,
          p85,
          p90,
          p95,
          p97,
          sourceUrl: spec.url,
          checksum: sha256,
          version: spec.version,
        },
        create: {
          standard: spec.standard,
          measure: spec.measure,
          sex,
          ageMonths,
          l,
          m,
          s,
          p3,
          p5,
          p10,
          p25,
          p50,
          p75,
          p85,
          p90,
          p95,
          p97,
          sourceUrl: spec.url,
          checksum: sha256,
          version: spec.version,
        },
      });

      fileImported++;
    }

    manifestEntries.push({
      fileName: spec.fileName,
      url: spec.url,
      standard: spec.standard,
      measure: spec.measure,
      sex: spec.sex,
      version: spec.version,
      sha256,
      sizeBytes: stats.size,
      downloadedAt: new Date().toISOString(),
      rowCount: fileImported,
    });

    totalImported += fileImported;
    console.log(`✓ Imported ${fileImported} rows for ${spec.fileName}`);
  }

  // Write MANIFEST.json
  const manifestPath = path.join(dataDir, 'MANIFEST.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(manifestEntries, null, 2),
    'utf-8',
  );
  console.log(
    `✓ Written ${manifestPath} with ${manifestEntries.length} entries.`,
  );
  console.log(
    `=== Ingestion Complete: ${totalImported} total rows imported ===`,
  );

  await prisma.$disconnect();
}

if (process.argv[1] && process.argv[1].includes('import-cdc')) {
  importCdcData().catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  });
}
