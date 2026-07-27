# TechDengue El Niño (monorepo)

Monorepo **privado** com o módulo **El Niño Analytics** extraído do TechDengue:

- `frontend/` — Next.js (dashboard `/el-nino-analytics` + mapa)
- `backend/` — NestJS slim (pipeline ONI / clima / casos / alertas)
- `data/frontend-cache/` — caches JSON de pipeline/mapa
- `docs/` — como rodar e arquitetura
- Credenciais em repositório separado: **`read_acessos`** (privado)

## Início rápido

```bash
# 1) Clone os dois repos privados (lado a lado)
# Documents/GitHub/techdengue-elnino
# Documents/GitHub/read_acessos

cd techdengue-elnino
npm run bootstrap:env
npm run install:all

# 2) Terminal A
npm run dev:backend

# 3) Terminal B
npm run dev:frontend
```

Abra: http://localhost:3001/el-nino-analytics

API health: http://localhost:8000/api/v1/el-nino-analytics/health

## Documentação

- [COMO-RODAR.md](docs/COMO-RODAR.md)
- [ARQUITETURA.md](docs/ARQUITETURA.md)

## Segurança

- Nenhum segredo real é versionado neste monorepo.
- Use `read_acessos/credenciais.env` + `npm run bootstrap:env`.
- Template sem valores: [`.env.example`](.env.example)
