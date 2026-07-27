#!/usr/bin/env python3
"""
cds_clima_elnino.py ÔÇö Baixa clima hist├│rico (ERA5) + proje├º├úo (SEAS5) do
Copernicus CDS e devolve um JSON consolidado por munic├¡pio.

Chamado por `CopernicusCdsService` (NestJS). Estrat├®gia de baixo custo:
- 1 ├║nico request ERA5 mensal cobrindo o bounding-box de todos os
  munic├¡pios solicitados (├║ltimos 5 anos completos).
- 1 ├║nico request SEAS5 (opcional, s├│ se LIVRE no contrato CDS do usu├írio)
  cobrindo o mesmo bbox para os pr├│ximos 6 meses.
- Interpola├º├úo nearest-neighbor por lat/lon para cada munic├¡pio.

I/O:
  Entrada (stdin JSON):
    {"municipios": [{"geocode": int, "nome": str, "lat": float, "lon": float}]}

  Sa├¡da (stdout JSON):
    {"linhas": [{"geocode": int, "municipio": str, "ano": int, "mes": int,
                "temperatura": float, "temp_max": float, "precipitacao": float,
                "umidade": float, "fonte": "ERA5"|"SEAS5"}, ...]}

Vari├íveis de ambiente:
  CDSAPI_URL  ÔÇö default https://cds.climate.copernicus.eu/api
  CDSAPI_KEY  ÔÇö token do Copernicus (formato UID:API-KEY ou s├│ API-KEY na
                vers├úo >= 0.7 do cdsapi). Obrigat├│rio.
  ERA5_ANOS_JANELA ÔÇö quantos anos de hist├│rico baixar (default: 5)
  SEAS5_HABILITADO ÔÇö '1' para tentar SEAS5; qualquer outro valor desativa
                     (default: '0' ÔÇö exige assinatura/licen├ºa adicional)

Em qualquer erro, sai com `linhas: []` e exit 0 ÔÇö o servi├ºo NestJS ent├úo
cai automaticamente em Open-Meteo Archive.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import sys
import tempfile
import traceback


def emitir(linhas, erro=None):
    """Imprime resultado em stdout e termina com exit 0."""
    payload = {"linhas": linhas}
    if erro:
        payload["erro"] = erro
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    sys.exit(0)


def log(msg):
    """Log de progresso vai pra stderr ÔÇö stdout ├® reservado pro JSON final."""
    sys.stderr.write(f"[cds_clima_elnino] {msg}\n")
    sys.stderr.flush()


def umidade_relativa_de_dewpoint(t_c, dp_c):
    """Magnus: derivar UR(%) a partir de temperatura e ponto de orvalho."""
    if t_c is None or dp_c is None:
        return 0.0
    try:
        es = 6.112 * math.exp((17.625 * t_c) / (243.04 + t_c))
        e = 6.112 * math.exp((17.625 * dp_c) / (243.04 + dp_c))
        ur = (e / es) * 100
        return max(0.0, min(100.0, ur))
    except Exception:
        return 0.0


def montar_bbox(municipios, margem=0.5):
    lats = [m["lat"] for m in municipios]
    lons = [m["lon"] for m in municipios]
    # CDS area: [north, west, south, east]
    return [
        max(lats) + margem,
        min(lons) - margem,
        min(lats) - margem,
        max(lons) + margem,
    ]


def baixar_era5_mensal(cliente, bbox, anos, destino):
    log(f"baixando ERA5 mensal anos={anos[0]}..{anos[-1]} bbox={bbox}")
    cliente.retrieve(
        "reanalysis-era5-single-levels-monthly-means",
        {
            "product_type": "monthly_averaged_reanalysis",
            "variable": [
                "2m_temperature",
                "total_precipitation",
                "2m_dewpoint_temperature",
            ],
            "year": [str(y) for y in anos],
            "month": [f"{m:02d}" for m in range(1, 13)],
            "time": "00:00",
            "area": bbox,
            "format": "netcdf",
        },
        destino,
    )


def baixar_seas5_mensal(cliente, bbox, ano, meses_alvo, destino):
    log(f"baixando SEAS5 mensal ano={ano} meses_lead={meses_alvo}")
    cliente.retrieve(
        "seasonal-monthly-single-levels",
        {
            "originating_centre": "ecmwf",
            "system": "51",
            "variable": [
                "2m_temperature",
                "total_precipitation",
            ],
            "product_type": "monthly_mean",
            "year": str(ano),
            "month": [f"{m:02d}" for m in meses_alvo[:1]],
            "leadtime_month": [str(i) for i in range(1, len(meses_alvo) + 1)],
            "area": bbox,
            "format": "netcdf",
        },
        destino,
    )


def carregar_netcdf(caminho):
    """Devolve dicion├írio com lat, lon, tempo, vari├íveis numpy."""
    from netCDF4 import Dataset, num2date  # type: ignore
    import numpy as np  # type: ignore

    nc = Dataset(caminho, "r")
    try:
        # Nome das dimens├Áes pode variar: latitude/lat, longitude/lon
        lat_var = nc.variables.get("latitude") or nc.variables.get("lat")
        lon_var = nc.variables.get("longitude") or nc.variables.get("lon")
        time_var = (
            nc.variables.get("valid_time")
            or nc.variables.get("time")
            or nc.variables.get("forecast_reference_time")
        )
        if lat_var is None or lon_var is None or time_var is None:
            raise RuntimeError("NetCDF sem vari├íveis lat/lon/time esperadas")

        out = {
            "lat": np.array(lat_var[:]),
            "lon": np.array(lon_var[:]),
            "tempo": num2date(
                time_var[:], time_var.units, only_use_cftime_datetimes=False
            ),
            "vars": {},
        }
        for nome in ("t2m", "tp", "d2m"):
            if nome in nc.variables:
                out["vars"][nome] = np.array(nc.variables[nome][:])
        return out
    finally:
        nc.close()


def interpolar_municipios(dados, municipios, fonte_rotulo):
    import numpy as np  # type: ignore

    lat_arr = dados["lat"]
    lon_arr = dados["lon"]
    tempos = dados["tempo"]
    t2m = dados["vars"].get("t2m")  # Kelvin
    tp = dados["vars"].get("tp")  # m/dia (ERA5) ou m/s (SEAS5) ÔÇö tratamos abaixo
    d2m = dados["vars"].get("d2m")  # Kelvin

    linhas = []
    for mun in municipios:
        geocode = mun["geocode"]
        nome = mun.get("nome", str(geocode))
        ilat = int(np.argmin(np.abs(lat_arr - mun["lat"])))
        ilon = int(np.argmin(np.abs(lon_arr - mun["lon"])))

        for it, tempo in enumerate(tempos):
            try:
                ano = int(tempo.year)
                mes = int(tempo.month)
            except AttributeError:
                # alguns NetCDF retornam np.datetime64
                ano = int(str(tempo)[:4])
                mes = int(str(tempo)[5:7])

            # Algumas dimens├Áes ERA5 v├¬m com eixo `expver` extra ÔÇö tratamos
            # pegando o primeiro slice se for o caso.
            def amostra(arr):
                if arr is None:
                    return None
                v = arr[it]
                while hasattr(v, "ndim") and v.ndim > 2:
                    v = v[0]
                return float(v[ilat, ilon])

            temp_k = amostra(t2m)
            tp_v = amostra(tp)
            d2m_k = amostra(d2m)

            temp_c = (temp_k - 273.15) if temp_k is not None else 0.0
            # ERA5 monthly tp ├® em metros/dia ÔåÆ convertemos pra mm/m├¬s (├ù 1000 ├ù 30)
            prec_mm = (tp_v * 1000 * 30) if tp_v is not None else 0.0
            if prec_mm < 0:
                prec_mm = 0.0
            dp_c = (d2m_k - 273.15) if d2m_k is not None else None
            ur = umidade_relativa_de_dewpoint(temp_c, dp_c) if dp_c else 0.0

            linhas.append(
                {
                    "geocode": geocode,
                    "municipio": nome,
                    "ano": ano,
                    "mes": mes,
                    "temperatura": round(temp_c, 2),
                    "temp_max": round(temp_c + 3.0, 2),
                    "precipitacao": round(prec_mm, 1),
                    "umidade": round(ur, 1),
                    "fonte": fonte_rotulo,
                }
            )
    return linhas


def main():
    try:
        raw = sys.stdin.read() or "{}"
        payload = json.loads(raw)
    except Exception as e:
        return emitir([], erro=f"stdin inv├ílido: {e}")

    municipios = payload.get("municipios") or []
    if not municipios:
        return emitir([], erro="nenhum munic├¡pio recebido em stdin")

    cds_url = os.environ.get(
        "CDSAPI_URL", "https://cds.climate.copernicus.eu/api"
    ).strip()
    cds_key = os.environ.get("CDSAPI_KEY", "").strip()
    if not cds_key:
        return emitir([], erro="CDSAPI_KEY n├úo configurada")

    try:
        import cdsapi  # type: ignore  # noqa: F401
        import numpy  # type: ignore  # noqa: F401
        from netCDF4 import Dataset  # type: ignore  # noqa: F401
    except ImportError as e:
        return emitir([], erro=f"depend├¬ncia Python ausente: {e}")

    import cdsapi  # type: ignore

    bbox = montar_bbox(municipios)
    ano_atual = dt.datetime.utcnow().year
    janela = int(os.environ.get("ERA5_ANOS_JANELA", "5"))
    anos = list(range(ano_atual - janela, ano_atual))

    try:
        cliente = cdsapi.Client(url=cds_url, key=cds_key, quiet=True, verify=True)
    except Exception as e:
        return emitir([], erro=f"falha inicializando cdsapi: {e}")

    tmpdir = tempfile.mkdtemp(prefix="cds_elnino_")
    linhas = []
    import atexit, shutil
    atexit.register(lambda d=tmpdir: shutil.rmtree(d, ignore_errors=True))

    try:
        arquivo_era5 = os.path.join(tmpdir, "era5.nc")
        try:
            baixar_era5_mensal(cliente, bbox, anos, arquivo_era5)
        except Exception as e:
            log(f"erro ERA5: {e}\n{traceback.format_exc()}")
            return emitir([], erro=f"download ERA5 falhou: {e}")

        try:
            dados_era5 = carregar_netcdf(arquivo_era5)
            linhas.extend(interpolar_municipios(dados_era5, municipios, "ERA5"))
        except Exception as e:
            log(f"erro parse ERA5: {e}\n{traceback.format_exc()}")
            return emitir([], erro=f"parse ERA5 falhou: {e}")

        if os.environ.get("SEAS5_HABILITADO", "0") == "1":
            # Próximos 6 meses
            meses_alvo = []
            ano_ref = ano_atual
            mes_ref = dt.datetime.utcnow().month
            for _ in range(6):
                mes_ref += 1
                if mes_ref > 12:
                    mes_ref = 1
                    ano_ref += 1
                meses_alvo.append(mes_ref)

            arquivo_seas5 = os.path.join(tmpdir, "seas5.nc")
            try:
                baixar_seas5_mensal(
                    cliente, bbox, ano_atual, meses_alvo, arquivo_seas5
                )
                dados_seas5 = carregar_netcdf(arquivo_seas5)
                linhas.extend(
                    interpolar_municipios(dados_seas5, municipios, "SEAS5")
                )
            except Exception as e:
                # SEAS5 é opcional — apenas loga e segue com só ERA5
                log(f"SEAS5 indisponível (segue só com ERA5): {e}")

        log(f"OK — {len(linhas)} linhas geradas para {len(municipios)} municípios")
        emitir(linhas)
    finally:
        try:
            import shutil

            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"erro fatal não tratado: {e}\n{traceback.format_exc()}")
        emitir([], erro=f"erro fatal: {e}")
