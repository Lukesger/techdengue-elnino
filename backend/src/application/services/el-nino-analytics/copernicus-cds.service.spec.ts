import {
  CDS_PYTHON_VENV_PADRAO,
  CDS_SCRIPT_PADRAO_DOCKER,
  lerCredenciaisCdsapirc,
  resolverCredenciaisCds,
  resolverPythonBin,
  resolverScriptCopernicus,
  resolverSslVerify,
} from './copernicus-cds.service';

describe('CopernicusCdsService runtime', () => {
  describe('resolverPythonBin', () => {
    it('usa PYTHON_BIN absoluto quando o arquivo existe', () => {
      const bin = '/opt/cdsapi-venv/bin/python';
      expect(resolverPythonBin(bin, 'linux', (p) => p === bin)).toBe(bin);
    });

    it('cai no venv Docker quando PYTHON_BIN absoluto não existe', () => {
      expect(
        resolverPythonBin(
          '/opt/cdsapi-venv/bin/python',
          'linux',
          (p) => p === CDS_PYTHON_VENV_PADRAO,
        ),
      ).toBe(CDS_PYTHON_VENV_PADRAO);
    });

    it('usa venv padrão Docker quando env vazio e venv existe', () => {
      expect(
        resolverPythonBin(
          undefined,
          'linux',
          (p) => p === CDS_PYTHON_VENV_PADRAO,
        ),
      ).toBe(CDS_PYTHON_VENV_PADRAO);
    });

    it('fallback para python3 em Linux sem venv', () => {
      expect(resolverPythonBin('', 'linux', () => false)).toBe('python3');
    });

    it('fallback para python no Windows', () => {
      expect(resolverPythonBin('', 'win32', () => false)).toBe('python');
    });
  });

  describe('resolverScriptCopernicus', () => {
    it('prioriza COPERNICUS_SCRIPT_PATH quando existe', () => {
      const custom = '/app/scripts/cds_clima_elnino.py';
      expect(
        resolverScriptCopernicus(custom, '/app', (p) => p === custom),
      ).toBe(custom);
    });

    it('usa path Docker padrão quando config vazio', () => {
      expect(
        resolverScriptCopernicus(
          undefined,
          '/app',
          (p) => p === CDS_SCRIPT_PADRAO_DOCKER,
        ),
      ).toBe(CDS_SCRIPT_PADRAO_DOCKER);
    });
  });

  describe('lerCredenciaisCdsapirc', () => {
    it('parseia url e key do ~/.cdsapirc', () => {
      const conteudo = 'url: https://cds.example/api\nkey: token-abc\n';
      expect(
        lerCredenciaisCdsapirc(
          '/home/user',
          (p) => p.endsWith('.cdsapirc'),
          () => conteudo,
        ),
      ).toEqual({
        url: 'https://cds.example/api',
        key: 'token-abc',
      });
    });

    it('retorna null quando key ausente', () => {
      expect(
        lerCredenciaisCdsapirc(
          '/home/user',
          (p) => p.endsWith('.cdsapirc'),
          () => 'url: https://cds.example/api\n',
        ),
      ).toBeNull();
    });
  });

  describe('resolverCredenciaisCds', () => {
    it('prioriza CDSAPI_KEY do .env', () => {
      expect(
        resolverCredenciaisCds('env-key', 'https://env.example/api', '/noop'),
      ).toEqual({
        key: 'env-key',
        url: 'https://env.example/api',
      });
    });

    it('cai no ~/.cdsapirc quando env vazio', () => {
      expect(
        resolverCredenciaisCds(
          '',
          '',
          '/home/user',
          (p) => p.endsWith('.cdsapirc'),
          () => 'key: file-key\n',
        ),
      ).toEqual({
        key: 'file-key',
        url: 'https://cds.climate.copernicus.eu/api',
      });
    });
  });

  describe('resolverSslVerify', () => {
    it('usa valor explicito do .env', () => {
      expect(resolverSslVerify('0', 'development', 'linux')).toBe('0');
    });

    it('desativa SSL em dev no Windows quando nao configurado', () => {
      expect(resolverSslVerify('', 'development', 'win32')).toBe('0');
    });

    it('mantem verify em producao', () => {
      expect(resolverSslVerify('', 'production', 'win32')).toBe('1');
    });
  });
});
