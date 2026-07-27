import { ForbiddenException } from '@nestjs/common';
import { ElNinoCasosPorBairroService } from './el-nino-casos-por-bairro.service';

describe('ElNinoCasosPorBairroService', () => {
  const pipeline = { getOverview: jest.fn() } as any;
  const scope = { resolverMunicipioParaGeometrias: jest.fn() } as any;
  const ibge = { resolverMunicipiosFoco: jest.fn() } as any;
  const tiposPorBairro = {
    getAreasMapeadasRaw: jest.fn(),
    resolveAtividadeIdsForMunicipio: jest.fn(),
    auditAreasMapeadas: jest.fn(),
    getTotalPorTipoCriadourosPorBairro: jest.fn(),
  } as any;

  const user = { id: 1 } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    scope.resolverMunicipioParaGeometrias.mockResolvedValue({
      geocode: 3106200,
      municipioId: 649,
      nome: 'Sabará',
      populacao: 1000,
    });
    tiposPorBairro.resolveAtividadeIdsForMunicipio.mockResolvedValue([7020]);
    ibge.resolverMunicipiosFoco.mockResolvedValue([
      { geocode: 3106200, municipio: 'Sabará', lat: 0, lon: 0 },
    ]);
    pipeline.getOverview.mockResolvedValue({
      df_municipios: [],
      df_mensal_mun: [],
    });
  });

  describe('getGeojsonBairros', () => {
    it('retorna polígonos brutos de area_mapeadas (1 feature por área)', async () => {
      tiposPorBairro.getAreasMapeadasRaw.mockResolvedValue([
        {
          id: 10,
          nome: 'BLOCO A',
          idSistema: 7020,
          idAtividade: 'ATV.1',
          areaHa: 12.5,
          hectaresUnicos: 12.5,
          pois: 0,
          geojson:
            '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
          metodoAtribuicao: 'area_mapeada_direta',
          fonteGeom: 'area_mapeadas',
          criterioAtribuicao: 'sem_transformacao',
        },
      ]);

      const service = new ElNinoCasosPorBairroService(
        pipeline,
        scope,
        ibge,
        tiposPorBairro,
      );

      const res = await service.getGeojsonBairros(user, {
        geocode: 3106200,
        idMunicipio: 649,
      });

      expect(scope.resolverMunicipioParaGeometrias).toHaveBeenCalledWith(
        user,
        3106200,
        undefined,
      );
      expect(tiposPorBairro.getAreasMapeadasRaw).toHaveBeenCalledWith(3106200, {
        atividadeIds: [7020],
      });
      expect(res.modo).toBe('areas_mapeadas');
      expect(res.features).toHaveLength(1);
      expect(res.features[0]?.properties).toMatchObject({
        area_id: 10,
        nome: 'BLOCO A',
        hectares_unicos: 12.5,
        metodo_atribuicao: 'area_mapeada_direta',
        fonte_geom: 'area_mapeadas',
        id_sistema: 7020,
      });
    });

    it('sem áreas válidas retorna modo indisponivel e id_sistemas da auditoria', async () => {
      tiposPorBairro.getAreasMapeadasRaw.mockResolvedValue([]);
      tiposPorBairro.auditAreasMapeadas.mockResolvedValue({
        geocode: 3106200,
        cd_mun_variantes: ['3106200'],
        resumo: {
          total_no_municipio: 2,
          com_geom_valida: 0,
          sem_geom: 1,
          sem_cd_mun: 1,
        },
        id_sistemas: [7020, 7021],
        id_sistemas_problematicos: [7020],
        areas_problematicas: [],
      });

      const service = new ElNinoCasosPorBairroService(
        pipeline,
        scope,
        ibge,
        tiposPorBairro,
      );

      const res = await service.getGeojsonBairros(user, {
        geocode: 3106200,
        idMunicipio: 649,
      });

      expect(res.modo).toBe('indisponivel');
      expect(res.features).toHaveLength(0);
      expect(res.id_sistemas).toEqual([7020, 7021]);
    });

    it('BOLA: idMunicipio alheio em geojson → 403', async () => {
      const service = new ElNinoCasosPorBairroService(
        pipeline,
        scope,
        ibge,
        tiposPorBairro,
      );

      await expect(
        service.getGeojsonBairros(user, {
          geocode: 3106200,
          idMunicipio: 99999,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tiposPorBairro.getAreasMapeadasRaw).not.toHaveBeenCalled();
    });

    it('BOLA: geocode fora do escopo propaga Forbidden do scope', async () => {
      scope.resolverMunicipioParaGeometrias.mockRejectedValue(
        new ForbiddenException('Geocodes fora do escopo do usuário: 3550308'),
      );
      const service = new ElNinoCasosPorBairroService(
        pipeline,
        scope,
        ibge,
        tiposPorBairro,
      );

      await expect(
        service.getGeojsonBairros(user, { geocode: 3550308 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getCasosPorBairro', () => {
    it('BOLA: idMunicipio alheio em casos → 403', async () => {
      const service = new ElNinoCasosPorBairroService(
        pipeline,
        scope,
        ibge,
        tiposPorBairro,
      );

      await expect(
        service.getCasosPorBairro(user, {
          geocode: 3106200,
          idMunicipio: 12345,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(
        tiposPorBairro.getTotalPorTipoCriadourosPorBairro,
      ).not.toHaveBeenCalled();
    });

    it('usa municipioId resolvido pelo escopo (ignora tentativa BOLA alinhada)', async () => {
      tiposPorBairro.getTotalPorTipoCriadourosPorBairro.mockResolvedValue({
        bairros: [],
        totalGeral: 0,
      });

      const service = new ElNinoCasosPorBairroService(
        pipeline,
        scope,
        ibge,
        tiposPorBairro,
      );

      await service.getCasosPorBairro(user, {
        geocode: 3106200,
        idMunicipio: 649,
      });

      expect(
        tiposPorBairro.getTotalPorTipoCriadourosPorBairro,
      ).toHaveBeenCalledWith(expect.objectContaining({ idMunicipio: 649 }));
    });
  });
});
