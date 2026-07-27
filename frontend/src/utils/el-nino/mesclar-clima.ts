export interface LinhaClimaMensal {
  geocode: number;
  Ano: number;
  MesNum: number;
  Temperatura?: number | null;
  TempMax?: number | null;
  Precipitacao?: number | null;
  Umidade?: number | null;
  municipio?: string;
  Mes?: string;
  _fonte_clima?: string | null;
}

function chaveClima(row: LinhaClimaMensal): string {
  return `${row.geocode}-${row.Ano}-${row.MesNum}`;
}

/** Linha com pelo menos um indicador climático utilizável. */
export function linhaClimaValida(row: LinhaClimaMensal | null | undefined): boolean {
  if (!row) return false;
  const temp = Number(row.Temperatura);
  const chuva = Number(row.Precipitacao);
  const umid = Number(row.Umidade);
  return (
    (Number.isFinite(temp) && temp > 0) ||
    (Number.isFinite(chuva) && chuva > 0) ||
    (Number.isFinite(umid) && umid > 0)
  );
}

/**
 * Padrão: Open-Meteo primeiro; ERA5/CDS preenche lacunas ou substitui linhas inválidas.
 */
export function mesclarClimaHistorico(
  openMeteo: LinhaClimaMensal[],
  era5: LinhaClimaMensal[],
): LinhaClimaMensal[] {
  const mapa = new Map<string, LinhaClimaMensal>();

  for (const row of era5) {
    if (linhaClimaValida(row)) {
      mapa.set(chaveClima(row), { ...row, _fonte_clima: row._fonte_clima ?? 'Copernicus ERA5' });
    }
  }

  for (const row of openMeteo) {
    const k = chaveClima(row);
    if (linhaClimaValida(row)) {
      mapa.set(k, { ...row, _fonte_clima: row._fonte_clima ?? 'Open-Meteo Archive' });
    } else if (!mapa.has(k)) {
      mapa.set(k, row);
    }
  }

  return Array.from(mapa.values()).sort(
    (a, b) => a.Ano - b.Ano || a.MesNum - b.MesNum || a.geocode - b.geocode,
  );
}

export function aplicarClimaNasLinhasMensais(
  linhas: any[],
  climaMesclado: LinhaClimaMensal[],
): any[] {
  const mapa = new Map(climaMesclado.map((c) => [chaveClima(c), c]));
  return linhas.map((linha) => {
    const clima = mapa.get(`${linha.geocode}-${linha.Ano}-${linha.MesNum}`);
    if (!clima || !linhaClimaValida(clima)) return linha;
    return {
      ...linha,
      Temperatura: clima.Temperatura ?? linha.Temperatura ?? null,
      TempMax: clima.TempMax ?? linha.TempMax ?? null,
      Precipitacao: clima.Precipitacao ?? linha.Precipitacao ?? null,
      Umidade: clima.Umidade ?? linha.Umidade ?? null,
      _fonte_clima: clima._fonte_clima ?? linha._fonte_clima ?? null,
    };
  });
}

export function coberturaClimaCompleta(
  clima: LinhaClimaMensal[],
  chavesCasos: Array<{ geocode: number; Ano: number; MesNum: number }>,
): boolean {
  if (!clima.length || !chavesCasos.length) return false;
  const mapa = new Map(clima.map((c) => [chaveClima(c), c]));
  return chavesCasos.every((r) => linhaClimaValida(mapa.get(`${r.geocode}-${r.Ano}-${r.MesNum}`)));
}
