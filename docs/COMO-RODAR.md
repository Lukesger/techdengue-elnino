# Como rodar

Este monorepo é **público**. Credenciais reais (se houver) ficam no repo privado `read_acessos`.

## Pré-requisitos

- Node.js 20+ (testado com 20–24)
- Git

## Opção A — Sem credenciais privadas (recrutadores / demo)

```bash
git clone https://github.com/Lukesger/techdengue-elnino.git
cd techdengue-elnino

# Windows
copy .env.example backend\.env
copy .env.example frontend\.env.local

# Em frontend/.env.local, garanta:
# NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
# ELNINO_DEMO_AUTH=true (já no example)

npm run install:all
```

Terminal A:

```bash
npm run dev:backend
```

Terminal B:

```bash
npm run dev:frontend
```

- Health: http://localhost:8000/api/v1/el-nino-analytics/health  
- Dashboard: http://localhost:3001/el-nino-analytics  
- Mapa: http://localhost:3001/el-nino-analytics/mapa (só com `NEXT_PUBLIC_MAPBOX_TOKEN`)

Modo demo (`ELNINO_DEMO_AUTH=true`): usa municípios foco (BH, Contagem, Betim, Uberlândia, Montes Claros) sem PostgreSQL obrigatório.

## Opção B — Com `read_acessos` (privado, dono do projeto)

```
Documents/GitHub/
  techdengue-elnino/
  read_acessos/
    credenciais.env
```

```bash
cd techdengue-elnino
npm run bootstrap:env
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Se falhar o bootstrap, confira `READ_ACESSOS_PATH` ou `../read_acessos/credenciais.env`.

## Dados locais

- Backend: `backend/data/el-nino/clima_historico.json`
- Frontend caches: `frontend/src/utils/el-nino/data/` e espelho em `data/frontend-cache/`

## Troubleshooting

| Sintoma | Ação |
|---------|------|
| `credenciais.env não encontrado` | Use a Opção A (`.env.example`) ou clone `read_acessos` |
| 401 no proxy Next | Confirme token demo no front e backend no ar |
| Mapa sem tiles | Preencha `NEXT_PUBLIC_MAPBOX_TOKEN` (token público `pk.`) |
| CDS/Copernicus | Opcional; sem `CDSAPI_KEY` usa Open-Meteo + store local |
