# TechDengue El Niño (monorepo)

Monorepo **público** com o módulo **El Niño Analytics** (front + back + dados + docs), extraído do TechDengue — pensado para visualização e execução local (ex.: recrutadores / portfólio).

- `frontend/` — Next.js (dashboard `/el-nino-analytics` + mapa)
- `backend/` — NestJS slim (pipeline ONI / clima / casos / alertas)
- `data/frontend-cache/` — caches JSON de pipeline/mapa
- `docs/` — como rodar e arquitetura

Credenciais reais (Mapbox, DB, etc.) ficam em um repositório **privado** separado (`read_acessos`), **não** versionado aqui.

## Para recrutadores (visão rápida)

| Item | Onde |
|------|------|
| Código front | [`frontend/`](frontend/) |
| Código back | [`backend/`](backend/) |
| Arquitetura | [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) |
| Como rodar | [`docs/COMO-RODAR.md`](docs/COMO-RODAR.md) |
| Health da API (local) | `GET /api/v1/el-nino-analytics/health` |

O backend sobe em **modo demo** (`ELNINO_DEMO_AUTH=true`) sem banco obrigatório, usando municípios foco e APIs públicas (NOAA / Open-Meteo / Infodengue) + caches locais.

## Início rápido (sem credenciais privadas)

```bash
git clone https://github.com/Lukesger/techdengue-elnino.git
cd techdengue-elnino

# Template público (sem segredos)
copy .env.example backend\.env
copy .env.example frontend\.env.local
# Ajuste NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1 no frontend/.env.local

npm run install:all

# Terminal A
npm run dev:backend

# Terminal B
npm run dev:frontend
```

- Front: http://localhost:3001/el-nino-analytics  
- API health: http://localhost:8000/api/v1/el-nino-analytics/health  

Mapa Mapbox só aparece se você definir `NEXT_PUBLIC_MAPBOX_TOKEN` (token público `pk.`). Demais telas/APIs demo funcionam sem isso.

## Com credenciais locais (opcional)

Se você tiver o repo privado `read_acessos` clonado ao lado:

```bash
npm run bootstrap:env
npm run install:all
npm run dev:backend
npm run dev:frontend
```

## Documentação

- [COMO-RODAR.md](docs/COMO-RODAR.md)
- [ARQUITETURA.md](docs/ARQUITETURA.md)

## Segurança

- Nenhum segredo real é versionado neste monorepo.
- Só há [`.env.example`](.env.example) com placeholders vazios.
- `read_acessos` permanece **privado**.
