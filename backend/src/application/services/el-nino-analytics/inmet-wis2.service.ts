import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { XMLParser } from 'fast-xml-parser';
import { CacheService } from '../../../shared/services/cache.service';
import { CACHE_KEYS, CACHE_TTL, ENDPOINTS } from './constants';

// ÔöÇÔöÇÔöÇ Interfaces ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

export type InmetSeveridade =
  | 'extreme'
  | 'severe'
  | 'moderate'
  | 'minor'
  | 'unknown';

export type InmetNivel = 'alto' | 'medio' | 'baixo';

export interface InmetAlerta {
  id: string;
  evento: string;
  severidade: InmetSeveridade;
  nivel: InmetNivel;
  /** Cor de risco em hex (ex: "#FF0000") */
  corRisco: string;
  inicio: string;
  fim: string;
  descricao: string;
  instrucao: string;
  areaDesc: string;
  /** Geocodes IBGE 7 d├¡gitos dos munic├¡pios afetados */
  municipios: number[];
  estados: string[];
  /** Tipo da mensagem (Alert/Update/Cancel) */
  msgType: string;
  /** Status (Actual/Test/Draft) */
  status: string;
  fonte: string;
}

interface RssItem {
  title: string;
  link: string;
  description: string;
}

// ÔöÇÔöÇÔöÇ Servi├ºo ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

/**
 * InmetWis2Service ÔÇö alertas meteorol├│gicos INMET via RSS + CAP XML.
 *
 * Fluxo:
 *   1. Fetch RSS `apiprevmet3.inmet.gov.br/avisos/rss`
 *   2. Extrai links dos alertas individuais (formato CAP XML)
 *   3. Fetch + parse de cada alerta via fast-xml-parser
 *   4. Filtra pelos geocodes do escopo do usu├írio
 *
 * Cache: 15 minutos (alertas s├úo urgentes).
 */
@Injectable()
export class InmetWis2Service {
  private readonly logger = new Logger(InmetWis2Service.name);

  /** Parser XML reutiliz├ível ÔÇö configurado para CAP/RSS */
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseTagValue: true,
    parseAttributeValue: false,
    cdataPropName: '__cdata',
    trimValues: true,
    stopNodes: ['description', 'instruction'],
    isArray: (name) =>
      ['item', 'info', 'area', 'parameter', 'resource'].includes(name),
  });

  constructor(
    private readonly http: HttpService,
    private readonly cache: CacheService,
  ) {}

  // ÔöÇÔöÇÔöÇ API p├║blica ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  /**
   * Busca alertas INMET filtrados pelos geocodes fornecidos.
   * geocodes = [] ÔåÆ retorna todos os alertas ativos.
   */
  async buscarAlertasPorGeocodes(
    geocodes: number[],
    forceRefresh = false,
  ): Promise<InmetAlerta[]> {
    const todos = await this.carregarTodosAlertas(forceRefresh);
    if (!geocodes.length) return todos;

    const set = new Set(geocodes);
    return todos.filter((a) => a.municipios.some((m) => set.has(m)));
  }

  /** Carrega todos os alertas INMET com cache de 15 min. */
  async carregarTodosAlertas(forceRefresh = false): Promise<InmetAlerta[]> {
    if (!forceRefresh) {
      const cached = await this.cache.getAsync<InmetAlerta[]>(
        CACHE_KEYS.INMET_ALERTAS,
      );
      if (cached) return cached;
    }

    try {
      const alertas = await this.fetchAlertas();
      if (alertas.length) {
        await this.cache.setAsync(
          CACHE_KEYS.INMET_ALERTAS,
          alertas,
          CACHE_TTL.INMET_ALERTAS_MS,
        );
      }
      return alertas;
    } catch (err) {
      this.logger.warn(`INMET WIS2 indisponivel: ${(err as Error).message}`);
      return [];
    }
  }

  /** Alias retrocompativel com implementacao remota. */
  async listarAlertasAtivos(forceRefresh = false): Promise<InmetAlerta[]> {
    return this.carregarTodosAlertas(forceRefresh);
  }

  /** Alias retrocompativel com implementacao remota. */
  async listarParaGeocodes(
    geocodes: number[],
    forceRefresh = false,
  ): Promise<InmetAlerta[]> {
    return this.buscarAlertasPorGeocodes(geocodes, forceRefresh);
  }

  // ─── Pipeline interno ────────────────────────────────────────────────────────

  private async fetchAlertas(): Promise<InmetAlerta[]> {
    const items = await this.fetchRss();
    if (!items.length) return [];

    const resultados = await Promise.allSettled(
      items.slice(0, 20).map((item) => this.fetchCapXml(item)),
    );

    const alertas: InmetAlerta[] = [];
    for (const r of resultados) {
      if (r.status === 'fulfilled' && r.value) alertas.push(r.value);
    }

    this.logger.debug(
      `INMET WIS2: ${alertas.length} alertas ativos de ${items.length} itens RSS`,
    );
    return alertas;
  }

  // ÔöÇÔöÇÔöÇ RSS Feed ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  private async fetchRss(): Promise<RssItem[]> {
    const res = await firstValueFrom(
      this.http.get<string>(ENDPOINTS.INMET_RSS, {
        responseType: 'text' as never,
        timeout: 20_000,
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
      }),
    );
    return this.parseRss(String(res.data ?? ''));
  }

  private parseRss(xml: string): RssItem[] {
    try {
      const parsed = this.xmlParser.parse(xml);
      const channel = parsed?.rss?.channel ?? parsed?.channel ?? {};
      const rawItems: unknown[] = Array.isArray(channel.item)
        ? channel.item
        : channel.item
          ? [channel.item]
          : [];

      return rawItems
        .map((it: any) => ({
          title: this.texto(it.title),
          link: this.texto(it.link) || this.texto(it.enclosure?.['@_url']),
          description: this.texto(it.description),
        }))
        .filter((i) => !!i.link);
    } catch (err) {
      this.logger.warn(`Falha ao parsear RSS INMET: ${(err as Error).message}`);
      return [];
    }
  }

  // ÔöÇÔöÇÔöÇ CAP XML ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  private async fetchCapXml(item: RssItem): Promise<InmetAlerta | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<string>(item.link, {
          responseType: 'text' as never,
          timeout: 15_000,
          headers: { Accept: 'application/xml, text/xml' },
        }),
      );
      return this.parseCapXml(String(res.data ?? ''), item.link);
    } catch (err) {
      this.logger.debug(
        `CAP indisponível (${item.link}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private parseCapXml(xml: string, url: string): InmetAlerta | null {
    try {
      const parsed = this.xmlParser.parse(xml);

      /* O namespace pode ser "alert" (padr├úo CAP) ou raiz direta */
      const root: any =
        parsed?.alert ??
        parsed?.['cap:alert'] ??
        Object.values(parsed ?? {})[0] ??
        {};

      const identifier = this.texto(root.identifier ?? root.id) || url;
      const status = this.texto(root.status) || 'Actual';
      const msgType = this.texto(root.msgType);

      // Ignorar cancelamentos e mensagens de teste
      if (msgType === 'Cancel' || status === 'Test' || status === 'Draft') {
        return null;
      }

      // `info` pode ser array ou objeto ├║nico
      const infos: any[] = Array.isArray(root.info)
        ? root.info
        : root.info
          ? [root.info]
          : [];

      // Escolhe o primeiro `info` em portugu├¬s (pt-BR) ou o primeiro dispon├¡vel
      const info: any =
        infos.find((i) =>
          String(i.language ?? '')
            .toLowerCase()
            .startsWith('pt'),
        ) ??
        infos[0] ??
        {};

      const evento = this.texto(info.event) || 'Alerta meteorológico INMET';
      const severity = this.texto(info.severity).toLowerCase();
      const onset = this.texto(info.onset);
      const expires = this.texto(info.expires);
      const descricao = this.texto(info.description);
      const instrucao = this.texto(info.instruction);

      // areaDesc
      const areas: any[] = Array.isArray(info.area)
        ? info.area
        : info.area
          ? [info.area]
          : [];
      const areaDesc = areas
        .map((a) => this.texto(a.areaDesc))
        .filter(Boolean)
        .join('; ');

      // Par├ómetros CAP (ColorRisk, Municipios, Estados)
      const params: any[] = Array.isArray(info.parameter)
        ? info.parameter
        : info.parameter
          ? [info.parameter]
          : [];

      const paramMap = new Map<string, string>();
      for (const p of params) {
        const nome = this.texto(p.valueName);
        const val = this.texto(p.value);
        if (nome) paramMap.set(nome, val);
      }

      const corRisco = paramMap.get('ColorRisk') ?? '#FFFE00';
      const municipiosRaw = paramMap.get('Municipios') ?? '';
      const estadosRaw = paramMap.get('Estados') ?? '';

      const municipios = municipiosRaw
        .split(/[\s,;]+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 1_000_000);

      const estados = estadosRaw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const nivel = this.mapearNivel(severity, corRisco);

      return {
        id: identifier,
        evento,
        severidade: this.mapearSeveridade(severity),
        nivel,
        corRisco,
        inicio: onset,
        fim: expires,
        descricao,
        instrucao,
        areaDesc,
        municipios,
        estados,
        msgType,
        status,
        fonte: 'INMET WIS2',
      };
    } catch (err) {
      this.logger.debug(`Falha ao parsear CAP XML: ${(err as Error).message}`);
      return null;
    }
  }

  // ÔöÇÔöÇÔöÇ Helpers ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

  private texto(v: unknown): string {
    if (v == null) return '';
    if (typeof v === 'object') {
      // fast-xml-parser pode retornar { __cdata: '...' } para CDATA
      const obj = v as Record<string, unknown>;
      if (obj.__cdata != null) return String(obj.__cdata).trim();
      if (obj['#text'] != null) return String(obj['#text']).trim();
    }
    return String(v).trim();
  }

  private mapearSeveridade(severity: string): InmetSeveridade {
    switch (severity) {
      case 'extreme':
        return 'extreme';
      case 'severe':
        return 'severe';
      case 'moderate':
        return 'moderate';
      case 'minor':
        return 'minor';
      default:
        return 'unknown';
    }
  }

  /**
   * Mapeia cor de risco + severidade para n├¡vel do sistema de alertas.
   * Prioridade: cor > severidade textual.
   */
  private mapearNivel(severity: string, corRisco: string): InmetNivel {
    const cor = corRisco.toUpperCase().replace(/\s/g, '');
    if (cor === '#FF0000' || cor === '#FF4500') return 'alto'; // vermelho
    if (cor === '#FF8C00' || cor === '#FFA500' || cor === '#FF6400')
      return 'alto'; // laranja
    if (cor === '#FFFE00' || cor === '#FFFF00' || cor === '#FFE000')
      return 'medio'; // amarelo
    if (cor === '#00FF00' || cor === '#008000' || cor === '#90EE90')
      return 'baixo'; // verde

    switch (severity) {
      case 'extreme':
      case 'severe':
        return 'alto';
      case 'moderate':
        return 'medio';
      default:
        return 'baixo';
    }
  }
}
