-- Migration 076 — conceder analytics:elnino:read a todos os perfis ativos.
-- Banco: techdengue_primary (PostgreSQL)
-- Espelho de: src/infrastructure/database/migrations/076-elnino-read-all-perfis.ts
-- Classe: ElNinoReadAllPerfis0761750600000000
--
-- Aplicar manualmente se `npm run migration:run` não puder rodar no alvo.
-- `analytics:elnino:refresh` permanece restrito (admin / migration 068).

BEGIN;

UPDATE perfis
SET permissoes = (
  SELECT COALESCE(json_agg(DISTINCT elem), '[]'::json)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(permissoes::jsonb, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT unnest(ARRAY['analytics:elnino:read']::text[])
  ) merged
),
updated_at = CURRENT_TIMESTAMP
WHERE deleted_at IS NULL;

INSERT INTO migrations (timestamp, name)
SELECT '1750600000000', 'ElNinoReadAllPerfis0761750600000000'
WHERE NOT EXISTS (
  SELECT 1 FROM migrations WHERE name = 'ElNinoReadAllPerfis0761750600000000'
);

COMMIT;

-- Validação (efeito da migration em perfis; registro em `migrations` já ficou no INSERT acima
SELECT
  COUNT(*) AS total_ativos,
  COUNT(*) FILTER (WHERE permissoes::jsonb ? 'analytics:elnino:read') AS com_elnino_read
FROM perfis
WHERE deleted_at IS NULL;
