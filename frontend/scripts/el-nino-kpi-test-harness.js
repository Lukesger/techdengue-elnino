/**
 * Harness compartilhado dos scripts de KPI El Niño (evita duplicação Sonar).
 */
const fs = require('node:fs');
const ts = require('typescript');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let tsLoaderRegistrado = false;

function registrarLoaderTs() {
  if (tsLoaderRegistrado) return;
  tsLoaderRegistrado = true;
  require.extensions['.ts'] = function carregarTs(mod, filename) {
    let src = fs.readFileSync(filename, 'utf8');
    src = src.replace(/^import\s+.*from\s+['"]@\/.*['"];?\s*$/gm, '');
    const js = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2019,
        esModuleInterop: true,
      },
    }).outputText;
    mod._compile(js, filename);
  };
}

function criarSuite() {
  let falhas = 0;
  function teste(nome, fn) {
    try {
      fn();
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas += 1;
      console.error(`  XX  ${nome}\n      ${e.message}`);
    }
  }
  function finalizar() {
    if (falhas) {
      console.error(`\n${falhas} falha(s)`);
      process.exit(1);
    }
    console.log('\nok');
  }
  return { teste, finalizar, assert };
}

module.exports = {
  assert,
  registrarLoaderTs,
  criarSuite,
};
