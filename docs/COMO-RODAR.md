# Como rodar

## Pré-requisitos

- Node.js 20+ (testado com 24)
- Conta GitHub **Lukesger** com acesso aos repos privados
- Pasta `read_acessos` clonada **ao lado** deste monorepo:

```
Documents/GitHub/
  techdengue-elnino/
  read_acessos/
    credenciais.env
```

## 1. Credenciais

```bash
cd techdengue-elnino
npm run bootstrap:env
```

Gera:

- `frontend/.env.local`
- `backend/.env`

Se falhar, confira `READ_ACESSOS_PATH` ou o caminho `../read_acessos/credenciais.env`.

## 2. Instalar

```bash
npm run install:all
```

## 3. Subir backend (porta 8000)

```bash
npm run dev:backend
```

Health: http://localhost:8000/api/v1/el-nino-analytics/health

Modo demo (`ELNINO_DEMO_AUTH=true`): aceita Bearer qualquer/`elnino-demo-token-local` e usa municípios foco (BH, Contagem, Betim, Uberlândia, Montes Claros).

## 4. Subir frontend (porta 3001)

```bash
npm run dev:frontend
```

- Dashboard: http://localhost:3001/el-nino-analytics  
- Mapa: http://localhost:3001/el-nino-analytics/mapa (precisa `NEXT_PUBLIC_MAPBOX_TOKEN` no `read_acessos`)

## Dados locais

- Backend: `backend/data/el-nino/clima_historico.json`
- Frontend caches: `frontend/src/utils/el-nino/data/` e espelho em `data/frontend-cache/`

## Troubleshooting

| Sintoma | Ação |
|---------|------|
| `credenciais.env não encontrado` | Clone `read_acessos` ao lado ou defina `READ_ACESSOS_PATH` |
| 401 no proxy Next | Confirme que o front gravou `techdengue_token` (hook `useAuth` demo) e que o back está no ar |
| Mapa sem tiles | Preencha `NEXT_PUBLIC_MAPBOX_TOKEN` e rode `bootstrap:env` de novo |
| CDS/Copernicus | Opcional; sem `CDSAPI_KEY` o pipeline usa Open-Meteo + store local |
