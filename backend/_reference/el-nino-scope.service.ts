import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { TerritorialScopeService } from '../territorial-scope.service';
import { Municipio } from '../../../domain/entities/municipio.entity';
import { ContratoPostgres } from '../../../domain/entities/contrato-postgres.entity';
import { UrsGeografico } from '../../../domain/entities/urs-geografico.entity';
import { Estado } from '../../../domain/entities/estado.entity';
import { User } from '../../../domain/entities/user.entity';
import { MUNICIPIOS_ELNINO } from './constants';

export type TipoEscopoElNino =
  | 'municipio'
  | 'consorcio'
  | 'urs'
  | 'macrorregiao'
  | 'microrregiao'
  | 'estado'
  | 'global';

export interface MunicipioEscopo {
  geocode: number;
  municipioId: number;
  nome: string;
  populacao: number;
}

export interface EscopoElNinoUsuario {
  tipo: TipoEscopoElNino;
  rotulo: string;
  descricao: string;
  municipios: MunicipioEscopo[];
  geocodes: number[];
  populacaoTotal: number;
  podeTrocar: boolean;
  podeAgregar: boolean;
  agregacaoDefault: 'soma' | 'ponderada';
  isGlobal: boolean;
}

/**
 * Resolve qual o "ângulo territorial" do usuário acessando o El Niño Analytics:
 * município, consórcio, URS, estado, global. Devolve os geocodes IBGE e a
 * população (para média ponderada) já calculados.
 */
@Injectable()
export class ElNinoScopeService {
  private readonly logger = new Logger(ElNinoScopeService.name);

  constructor(
    private readonly territorialScope: TerritorialScopeService,
    @InjectRepository(Municipio)
    private readonly municipioRepo: Repository<Municipio>,
    @InjectRepository(ContratoPostgres)
    private readonly contratoRepo: Repository<ContratoPostgres>,
    @InjectRepository(UrsGeografico)
    private readonly ursGeoRepo: Repository<UrsGeografico>,
    @InjectRepository(Estado)
    private readonly estadoRepo: Repository<Estado>,
  ) {}

  /**
   * Lista consórcios acessíveis ao usuário (com os municípios de cada um).
   * Para usuário com acesso global, retorna todos os contratos ativos.
   * Para usuário com escopo limitado, retorna apenas consórcios que tocam
   * o escopo territorial dele.
   */
  async listarConsorciosAcessiveis(user: User): Promise<
    Array<{
      id: number;
      nome: string;
      /** 0 = verba direta; 1 = consórcio. Necessário no front para plotar area_mapeadas. */
      eConsorcio: number;
      n_municipios: number;
      municipios: Array<{ geocode: number; nome: string }>;
    }>
  > {
    const scope = await this.territorialScope.getUserTerritorialScope(user);

    // Filtra contratos: globais veem todos; demais só os que estão no escopo deles
    let contratoIds: number[] | null = null;
    if (!scope.isGlobal) {
      const consorciosDoEscopo = new Set<number>(scope.consorcioIds);
      if (scope.municipioIds.length) {
        const munsEscopo = await this.municipioRepo.find({
          where: { id: In(scope.municipioIds), deletedAt: IsNull() },
          select: ['idContrato'],
        });
        for (const m of munsEscopo) {
          if (m.idContrato && Number(m.idContrato) > 0) {
            consorciosDoEscopo.add(Number(m.idContrato));
          }
        }
      }
      if (!consorciosDoEscopo.size) return [];
      contratoIds = [...consorciosDoEscopo];
    }

    const contratos = await this.contratoRepo.find({
      where: contratoIds
        ? { id: In(contratoIds), deletedAt: IsNull() }
        : { deletedAt: IsNull() },
      select: ['id', 'nome', 'eConsorcio'],
    });
    if (!contratos.length) return [];

    const todos = await this.municipioRepo.find({
      where: {
        idContrato: In(contratos.map((c) => Number(c.id))),
        deletedAt: IsNull(),
      },
      select: ['id', 'nome', 'codigoIbge', 'idContrato'],
    });

    return contratos
      .map((c) => {
        const muns = todos
          .filter((m) => Number(m.idContrato) === Number(c.id))
          .filter((m) => Number.isFinite(Number(m.codigoIbge)))
          .map((m) => ({
            geocode: Number(m.codigoIbge),
            nome: m.nome,
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return {
          id: Number(c.id),
          nome: c.nome,
          eConsorcio: Number(c.eConsorcio) === 1 ? 1 : 0,
          n_municipios: muns.length,
          municipios: muns,
        };
      })
      .filter((c) => c.n_municipios > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /**
   * Lista URS acessíveis ao usuário (com os municípios de cada uma).
   */
  async listarUrsAcessiveis(user: User): Promise<
    Array<{
      id: number;
      nome: string;
      n_municipios: number;
      municipios: Array<{ geocode: number; nome: string }>;
    }>
  > {
    const scope = await this.territorialScope.getUserTerritorialScope(user);

    let ursIds: number[] | null = null;
    if (!scope.isGlobal) {
      const ursDoEscopo = new Set<number>(scope.ursIds);
      if (scope.municipioIds.length) {
        const munsEscopo = await this.municipioRepo.find({
          where: { id: In(scope.municipioIds), deletedAt: IsNull() },
          select: ['urs'],
        });
        for (const m of munsEscopo) {
          if (m.urs && Number(m.urs) > 0) ursDoEscopo.add(Number(m.urs));
        }
      }
      if (!ursDoEscopo.size) return [];
      ursIds = [...ursDoEscopo];
    }

    const urs = await this.ursGeoRepo.find({
      where: ursIds
        ? { id: In(ursIds), deletedAt: IsNull() }
        : { deletedAt: IsNull() },
      select: ['id', 'nome'],
    });
    if (!urs.length) return [];

    const todos = await this.municipioRepo.find({
      where: {
        urs: In(urs.map((u) => Number(u.id))),
        deletedAt: IsNull(),
      },
      select: ['id', 'nome', 'codigoIbge', 'urs'],
    });

    return urs
      .map((u) => {
        const muns = todos
          .filter((m) => Number(m.urs) === Number(u.id))
          .filter((m) => Number.isFinite(Number(m.codigoIbge)))
          .map((m) => ({
            geocode: Number(m.codigoIbge),
            nome: m.nome,
          }))
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return {
          id: Number(u.id),
          nome: u.nome,
          n_municipios: muns.length,
          municipios: muns,
        };
      })
      .filter((u) => u.n_municipios > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async resolverParaUsuario(user: User): Promise<EscopoElNinoUsuario> {
    const scope = await this.territorialScope.getUserTerritorialScope(user);

    if (scope.isGlobal) {
      const consorcios = await this.listarConsorciosAcessiveis(user);
      const porGeocode = new Map<number, MunicipioEscopo>();
      for (const c of consorcios) {
        for (const m of c.municipios) {
          const gc = Number(m.geocode);
          if (!porGeocode.has(gc)) {
            porGeocode.set(gc, {
              geocode: gc,
              municipioId: 0,
              nome: m.nome,
              populacao: 0,
            });
          }
        }
      }
      const seed = await this.carregarMunicipios([...porGeocode.keys()], false);
      const popMap = new Map(seed.map((m) => [m.geocode, m]));
      const municipios = [...porGeocode.keys()].map((g) => {
        const hit = popMap.get(g);
        return (
          hit ?? {
            geocode: g,
            municipioId: 0,
            nome: porGeocode.get(g)!.nome,
            populacao: 0,
          }
        );
      });
      return {
        tipo: 'global',
        rotulo: 'Todos os contratos · Minas Gerais',
        descricao: `${consorcios.length} contratos (consórcios + verba direta) · ${municipios.length} municípios`,
        municipios,
        geocodes: municipios.map((m) => m.geocode),
        populacaoTotal: municipios.reduce((s, m) => s + m.populacao, 0),
        podeTrocar: true,
        podeAgregar: true,
        agregacaoDefault: 'ponderada',
        isGlobal: true,
      };
    }

    const tipo = this.inferirTipo(scope);

    if (tipo === 'estado') {
      const municipiosIds = scope.municipioIds;
      const muns = await this.carregarMunicipiosPorPk(municipiosIds);
      const estados = await this.estadoRepo.find({
        where: { id: In(scope.estadoIds), deletedAt: IsNull() },
        select: ['id', 'nome', 'sigla'],
      });
      const rotulo = estados.length
        ? `Estado · ${estados.map((e) => e.sigla ?? e.nome).join(', ')}`
        : 'Estado';
      return this.montar({
        tipo: 'estado',
        rotulo,
        descricao: `${muns.length} municípios no escopo estadual do usuário.`,
        municipios: muns,
      });
    }

    if (tipo === 'consorcio') {
      const muns = await this.carregarMunicipiosPorPk(scope.municipioIds);
      const contratos = await this.contratoRepo.find({
        where: { id: In(scope.consorcioIds), deletedAt: IsNull() },
        select: ['id', 'nome'],
      });
      const rotulo = contratos.length
        ? `Consórcio · ${contratos.map((c) => c.nome).join(' / ')}`
        : 'Consórcio';
      return this.montar({
        tipo: 'consorcio',
        rotulo,
        descricao: `${muns.length} municípios pertencentes ao(s) consórcio(s) do usuário.`,
        municipios: muns,
      });
    }

    if (tipo === 'urs') {
      const muns = await this.carregarMunicipiosPorPk(scope.municipioIds);
      const urs = await this.ursGeoRepo.find({
        where: { id: In(scope.ursIds), deletedAt: IsNull() },
        select: ['id', 'nome'],
      });
      const rotulo = urs.length
        ? `URS · ${urs.map((u) => u.nome).join(', ')}`
        : 'URS Regional';
      return this.montar({
        tipo: 'urs',
        rotulo,
        descricao: `${muns.length} municípios da(s) URS regional(is) do usuário.`,
        municipios: muns,
      });
    }

    if (tipo === 'macrorregiao' || tipo === 'microrregiao') {
      const muns = await this.carregarMunicipiosPorPk(scope.municipioIds);
      return this.montar({
        tipo,
        rotulo:
          tipo === 'macrorregiao'
            ? 'Macrorregião de saúde'
            : 'Microrregião de saúde',
        descricao: `${muns.length} municípios na sua área regional.`,
        municipios: muns,
      });
    }

    // Município simples
    const muns = await this.carregarMunicipiosPorPk(scope.municipioIds);
    const rotulo =
      muns.length === 1
        ? `Município · ${muns[0].nome}`
        : muns.length
          ? `Municípios vinculados (${muns.length})`
          : 'Sem município vinculado';
    return this.montar({
      tipo: 'municipio',
      rotulo,
      descricao:
        muns.length === 1
          ? 'Usuário com escopo de um único município.'
          : 'Usuário com múltiplos municípios vinculados.',
      municipios: muns,
    });
  }

  /**
   * Resolve o escopo + valida que os geocodes solicitados pelo cliente
   * (ex.: ?geocodes=3106200,3118601) estão dentro do escopo do usuário.
   * Se nenhum geocode for solicitado, devolve todos os do escopo
   * (opcionalmente restritos a `contratoId`).
   */
  async resolverEFiltrar(
    user: User,
    geocodesSolicitados?: number[],
    contratoId?: number,
  ): Promise<EscopoElNinoUsuario & { foco: MunicipioEscopo[] }> {
    const escopo = await this.resolverParaUsuario(user);
    const permitidos = new Set(escopo.geocodes);
    let base = escopo.municipios;

    const cid =
      contratoId != null && Number(contratoId) > 0
        ? Number(contratoId)
        : undefined;

    let geocodesDoContrato: Set<number> | null = null;
    if (cid != null) {
      const doContrato = await this.municipioRepo.find({
        where: { idContrato: cid, deletedAt: IsNull() },
        select: ['codigoIbge'],
      });
      geocodesDoContrato = new Set(
        doContrato
          .map((m) => Number(m.codigoIbge))
          .filter((g) => Number.isFinite(g) && g > 0),
      );
      const filtrados = base.filter((m) => geocodesDoContrato!.has(m.geocode));
      if (escopo.isGlobal && filtrados.length < geocodesDoContrato.size) {
        const faltantes = [...geocodesDoContrato].filter(
          (g) => !filtrados.some((m) => m.geocode === g),
        );
        base = [
          ...filtrados,
          ...(await this.carregarMunicipios(faltantes, false)),
        ];
      } else {
        base = filtrados;
      }
    }

    const limpos = (geocodesSolicitados ?? [])
      .map((g) => Number(g))
      .filter((g) => Number.isFinite(g) && g > 0);

    if (limpos.length === 0) {
      return { ...escopo, foco: base };
    }

    if (!escopo.isGlobal) {
      const fora = limpos.filter((g) => !permitidos.has(g));
      if (fora.length) {
        throw new ForbiddenException(
          `Geocodes fora do escopo do usuário: ${fora.join(', ')}`,
        );
      }
    }

    if (geocodesDoContrato) {
      const foraContrato = limpos.filter((g) => !geocodesDoContrato!.has(g));
      if (foraContrato.length) {
        throw new ForbiddenException(
          `Geocodes fora do contrato ${cid}: ${foraContrato.join(', ')}`,
        );
      }
    }

    const baseMap = new Map(base.map((m) => [m.geocode, m]));
    let foco = limpos
      .map((g) => baseMap.get(g))
      .filter((m): m is MunicipioEscopo => !!m);

    // Global pode escolher qualquer geocode de MG — carrega sob demanda.
    if (escopo.isGlobal && foco.length < limpos.length) {
      const faltantes = limpos.filter((g) => !baseMap.has(g));
      const extras = await this.carregarMunicipios(faltantes, false);
      foco = [...foco, ...extras];
    }

    return { ...escopo, foco };
  }

  /**
   * Resolve município para geometrias de mapa (area_mapeadas / geojson-bairros).
   * Mais permissivo que resolverEFiltrar: aceita verba direta fora da lista
   * fixa MUNICIPIOS_ELNINO quando o usuário tem acesso territorial ao contrato.
   */
  async resolverMunicipioParaGeometrias(
    user: User,
    geocode: number,
    idContrato?: number,
  ): Promise<MunicipioEscopo> {
    const gc = Number(geocode);
    if (!Number.isFinite(gc) || gc <= 0) {
      throw new ForbiddenException('geocode inválido');
    }

    try {
      const escopo = await this.resolverEFiltrar(user, [gc], idContrato);
      const mun =
        escopo.foco.find((m) => m.geocode === gc) ??
        escopo.municipios.find((m) => m.geocode === gc);
      if (mun) {
        if (idContrato) {
          await this.validarMunicipioContrato(mun.municipioId, gc, idContrato);
        }
        return mun;
      }
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
    }

    const row = await this.buscarMunicipioPorGeocode(gc);
    if (row) {
      await this.validarAcessoMunicipioMapa(user, row, idContrato);
      return {
        geocode: gc,
        municipioId: Number(row.id),
        nome: row.nome,
        populacao: Number(row.populacao ?? 0),
      };
    }

    const scope = await this.territorialScope.getUserTerritorialScope(user);
    if (
      scope.isGlobal ||
      (idContrato != null &&
        idContrato > 0 &&
        (await this.territorialScope.hasAccessToConsorcio(user, idContrato)))
    ) {
      return {
        geocode: gc,
        municipioId: 0,
        nome: `Município ${gc}`,
        populacao: 0,
      };
    }

    throw new NotFoundException(
      `Município com geocode ${gc} não encontrado no escopo do usuário`,
    );
  }

  private async buscarMunicipioPorGeocode(
    geocode: number,
  ): Promise<Municipio | null> {
    const gc = Number(geocode);
    return (
      (await this.municipioRepo.findOne({
        where: { codigoIbge: gc, deletedAt: IsNull() },
      })) ??
      (await this.municipioRepo.findOne({
        where: {
          codigoIbge: Number(String(gc).padStart(7, '0')),
          deletedAt: IsNull(),
        },
      }))
    );
  }

  private async validarMunicipioContrato(
    municipioId: number,
    geocode: number,
    idContrato: number,
  ): Promise<void> {
    if (!municipioId || municipioId <= 0) return;
    const row = await this.municipioRepo.findOne({
      where: { id: municipioId, deletedAt: IsNull() },
      select: ['id', 'idContrato', 'codigoIbge'],
    });
    if (row?.idContrato && Number(row.idContrato) !== Number(idContrato)) {
      throw new ForbiddenException(
        `Município ${geocode} não pertence ao contrato ${idContrato}`,
      );
    }
  }

  private async validarAcessoMunicipioMapa(
    user: User,
    row: Municipio,
    idContrato?: number,
  ): Promise<void> {
    const munId = Number(row.id);
    const contratoMun = Number(row.idContrato ?? 0);

    if (
      idContrato != null &&
      idContrato > 0 &&
      contratoMun > 0 &&
      contratoMun !== Number(idContrato)
    ) {
      throw new ForbiddenException(
        `Município ${row.codigoIbge} não pertence ao contrato ${idContrato}`,
      );
    }

    const scope = await this.territorialScope.getUserTerritorialScope(user);
    if (scope.isGlobal) return;

    if (await this.territorialScope.hasAccessToMunicipio(user, munId)) {
      return;
    }

    if (
      contratoMun > 0 &&
      (await this.territorialScope.hasAccessToConsorcio(user, contratoMun))
    ) {
      return;
    }

    if (
      idContrato != null &&
      idContrato > 0 &&
      (await this.territorialScope.hasAccessToConsorcio(user, idContrato))
    ) {
      return;
    }

    throw new ForbiddenException(
      `Sem acesso territorial ao município ${row.nome} (geocode ${row.codigoIbge})`,
    );
  }

  private inferirTipo(scope: {
    estadoIds: number[];
    consorcioIds: number[];
    ursIds: number[];
    macrorregiaoCodigos: number[];
    microrregiaoCodigos: number[];
    municipioIds: number[];
  }): TipoEscopoElNino {
    if (scope.estadoIds.length) return 'estado';
    if (scope.consorcioIds.length) return 'consorcio';
    if (scope.ursIds.length) return 'urs';
    if (scope.macrorregiaoCodigos.length) return 'macrorregiao';
    if (scope.microrregiaoCodigos.length) return 'microrregiao';
    return 'municipio';
  }

  private montar(opts: {
    tipo: TipoEscopoElNino;
    rotulo: string;
    descricao: string;
    municipios: MunicipioEscopo[];
  }): EscopoElNinoUsuario {
    const populacaoTotal = opts.municipios.reduce(
      (s, m) => s + (m.populacao ?? 0),
      0,
    );
    return {
      tipo: opts.tipo,
      rotulo: opts.rotulo,
      descricao: opts.descricao,
      municipios: opts.municipios,
      geocodes: opts.municipios.map((m) => m.geocode),
      populacaoTotal,
      podeTrocar: opts.municipios.length > 1,
      podeAgregar: opts.municipios.length > 1,
      agregacaoDefault: populacaoTotal > 0 ? 'ponderada' : 'soma',
      isGlobal: false,
    };
  }

  private async carregarMunicipiosPorPk(
    municipioIds: number[],
  ): Promise<MunicipioEscopo[]> {
    if (!municipioIds.length) return [];
    const rows = await this.municipioRepo.find({
      where: { id: In([...new Set(municipioIds)]), deletedAt: IsNull() },
      select: ['id', 'nome', 'codigoIbge', 'populacao'],
    });
    return rows
      .filter((r) => Number.isFinite(Number(r.codigoIbge)))
      .map((r) => ({
        geocode: Number(r.codigoIbge),
        municipioId: Number(r.id),
        nome: r.nome,
        populacao: Number(r.populacao ?? 0),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /**
   * Carrega municípios diretamente por geocode IBGE (usado para usuários globais
   * que selecionam geocodes arbitrários — sem passar pelo escopo restritivo).
   */
  private async carregarMunicipios(
    geocodes: number[],
    requireValidPopulation: boolean,
  ): Promise<MunicipioEscopo[]> {
    if (!geocodes.length) return [];
    const rows = await this.municipioRepo.find({
      where: { codigoIbge: In([...new Set(geocodes)]), deletedAt: IsNull() },
      select: ['id', 'nome', 'codigoIbge', 'populacao'],
    });
    const map = new Map(rows.map((r) => [Number(r.codigoIbge), r]));
    return geocodes
      .map((g) => {
        const r = map.get(g);
        if (!r) {
          const seed = MUNICIPIOS_ELNINO.find((m) => m.geocode === g);
          if (seed) {
            return {
              geocode: g,
              municipioId: 0,
              nome: seed.municipio,
              populacao: 0,
            };
          }
          if (!requireValidPopulation) {
            return {
              geocode: g,
              municipioId: 0,
              nome: `Município ${g}`,
              populacao: 0,
            };
          }
          return null;
        }
        const pop = Number(r.populacao ?? 0);
        if (requireValidPopulation && pop <= 0) {
          return {
            geocode: Number(r.codigoIbge),
            municipioId: Number(r.id),
            nome: r.nome,
            populacao: 0,
          };
        }
        return {
          geocode: Number(r.codigoIbge),
          municipioId: Number(r.id),
          nome: r.nome,
          populacao: pop,
        };
      })
      .filter((m): m is MunicipioEscopo => m !== null);
  }
}
