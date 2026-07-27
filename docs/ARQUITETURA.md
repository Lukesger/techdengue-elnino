# Arquitetura — El Niño Analytics

## Visão geral

```
Browser (Next :3001)
  └─ /el-nino-analytics (+ /mapa)
       └─ /api/el-nino-analytics/*  (proxy Next)
            └─ Nest API :8000 /api/v1/el-nino-analytics/*
                 ├─ NOAA ONI (oni.ascii.txt)
                 ├─ Open-Meteo (ERA5 archive + forecast)
                 ├─ Infodengue (casos mensais)
                 ├─ IBGE (municípios / malha)
                 ├─ INMET WIS2 (alertas)
                 └─ Copernicus CDS (opcional, via Python)
```

## Pipeline (backend)

`ElNinoPipelineService.getOverview()` monta o pacote:

1. Classifica fase El Niño via ONI (limiar ±0.5)
2. Junta clima histórico + previsão
3. Casos de dengue mensais
4. Correlações Pearson (temp/chuva/ONI × casos)
5. Comparativo Com/Sem El Niño
6. Alertas preditivos (`elnino`, chuva, calor, dengue, inmet)

No monorepo slim, o escopo territorial é fixo em `MUNICIPIOS_ELNINO` (demo). O controller completo com TypeORM/JWT de produção fica em `backend/_reference/` (referência, não compilado).

## Frontend

- Páginas: `src/pages/el-nino-analytics/`
- Componentes: `src/components/el-nino/`
- Utils + caches: `src/utils/el-nino/`
- Cliente: `src/services/el-nino-api.ts`
- Proxy: `src/pages/api/el-nino-analytics/[...slug].ts`

Stubs mínimos (só neste monorepo): `MainLayout`, `useAuth` (token demo), `ENV`, `BreadcrumbHeader`.

## Credenciais

| Repo | Conteúdo |
|------|----------|
| `techdengue-elnino` | Código + dados + `.env.example` |
| `read_acessos` (privado) | `credenciais.env` (Mapbox, DB, JWT, CDS…) |

`scripts/bootstrap-env.mjs` lê `read_acessos` e gera os `.env` locais.

## Fontes externas

- NOAA CPC ONI
- Open-Meteo Archive / Forecast
- Infodengue AlertCity
- IBGE localidades / malhas
- INMET WIS2
- Copernicus CDS (opcional)
