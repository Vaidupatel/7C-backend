-- Migration: Transform existing legacy array-of-strings reasons to structured JSON objects (F7)
UPDATE "TriageResult"
SET "reasons" = (
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(elem) = 'object' THEN elem
        ELSE jsonb_build_object(
          'code', CASE
            WHEN elem::text ILIKE '%growth%' OR elem::text ILIKE '%underweight%' OR elem::text ILIKE '%wasting%' OR elem::text ILIKE '%stature%' THEN 'GROWTH_FLAG'
            WHEN elem::text ILIKE '%red flag%' OR elem::text ILIKE '%sign%' THEN 'RED_FLAG_SIGN'
            WHEN elem::text ILIKE '%vital%' THEN 'VITAL_ALERT'
            WHEN elem::text ILIKE '%missing%' OR elem::text ILIKE '%warning%' THEN 'SAFETY_WARNING'
            ELSE 'CLINICAL_NOTE'
          END,
          'severity', CASE
            WHEN elem::text ILIKE '%emergency%' OR elem::text ILIKE '%critical%' OR elem::text ILIKE '%severe%' THEN 'EMERGENCY'
            WHEN elem::text ILIKE '%priority%' OR elem::text ILIKE '%abnormal%' OR elem::text ILIKE '%alert%' THEN 'PRIORITY'
            ELSE 'ROUTINE'
          END,
          'label', trim(both '"' from elem::text),
          'source', CASE
            WHEN elem::text ILIKE '%growth%' OR elem::text ILIKE '%underweight%' OR elem::text ILIKE '%wasting%' OR elem::text ILIKE '%stature%' THEN 'GROWTH'
            WHEN elem::text ILIKE '%red flag%' OR elem::text ILIKE '%sign%' THEN 'SIGNS'
            WHEN elem::text ILIKE '%vital%' THEN 'VITALS'
            WHEN elem::text ILIKE '%missing%' OR elem::text ILIKE '%warning%' THEN 'WARNING'
            ELSE 'SYSTEM'
          END
        )
      END
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements("reasons"::jsonb) AS elem
)
WHERE jsonb_typeof("reasons"::jsonb) = 'array'
  AND jsonb_array_length("reasons"::jsonb) > 0
  AND jsonb_typeof(("reasons"::jsonb)->0) = 'string';
