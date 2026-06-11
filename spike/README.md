# Spike TUI — terminal-kit vs OpenTUI

Prototipo comparativo per la TUI full-screen unificata di go-dev (schermata di
selezione a tab → viewer log streaming). Obiettivo: scegliere la libreria di
base sui **fatti**, non sulle opinioni.

Entrambi gli spike implementano le **stesse due schermate**, alimentate dalla
**stessa** sorgente di log fasulla ad alto volume (`shared/fake-log-source.js`,
~350 righe/s, mix servizi + libreria/`core`):

1. **SELECT** — due tab (`Presets` / `Services & Modes`).
2. **LOGS** — pannello scrollabile con filtro libreria-vs-servizi (`f`, `1-4`, `a`).

## Come eseguire

```bash
# interattivo (serve un vero terminale)
cd terminal-kit && npm install && npm start
cd opentui     && npm install && npm start     # ⚠️ richiede Bun, vedi sotto

# smoke test non interattivo (sotto pseudo-TTY, auto-exit dopo ~1.5s)
script -qec "stty rows 40 cols 120; node index.js --smoke" /dev/null   # terminal-kit
script -qec "stty rows 40 cols 120; bun  index.js --smoke" /dev/null   # opentui
```

## Risultati misurati (Node 22.22, Linux x64)

| Criterio | terminal-kit | OpenTUI (`@opentui/core` 0.4) |
|---|---|---|
| **Gira su Node.js** | ✅ `received=480`, ok | ❌ **fallisce all'init** |
| **Runtime richiesto** | Node (JS puro) | **Bun** (`received=498`, ok solo con `bun`) |
| Tab nativi | ❌ fatti a mano (~15 righe) | ✅ `TabSelectRenderable` (con descrizioni/underline) |
| Log scrollabili nativi | ✅ `TextBox` + `appendLog` | ✅ `ScrollBoxRenderable` (stickyScroll bottom) |
| LOC dello shell | 161 | 137 (tab gratis dal widget) |
| Footprint installato | **4.2 MB**, pure JS, 0 binari | **18 MB**, include `libopentui.so` per-piattaforma |
| Cross-platform | ovunque giri Node | binario nativo per OS/arch (linux/darwin/win32 x64+arm64 presenti su npm) |

## Il blocco decisivo: OpenTUI richiede Bun

OpenTUI renderizza tramite **FFI nativo**. Il backend FFI nel bundle fa così:

```js
if (isBun) return createBunBackend(require("bun:ffi"));   // ok
try   { return createNodeBackend(require("node:ffi")); }  // node:ffi NON ESISTE
catch { return createUnsupportedBackend(error); }         // -> throw all'uso
```

`node:ffi` **non è un modulo di Node** (`ERR_UNKNOWN_BUILTIN_MODULE`), quindi
sotto Node il render lib non si inizializza e `createCliRenderer()` lancia:

```
Error: Failed to initialize OpenTUI render library:
       OpenTUI native FFI is not available for this runtime yet
```

Sotto **Bun** lo stesso identico codice funziona e renderizza benissimo (tab con
descrizioni, underline, viewer log pinnato in fondo). La pagina "getting started"
dice che puoi *importare* `@opentui/core` da Node — ed è vero — ma *renderizzare*
no: serve Bun.

## Conclusione / raccomandazione

Per go-dev **così com'è (CLI Node.js)** la scelta è **terminal-kit**:

- è l'unico dei due che **gira sul runtime del progetto** senza migrazioni;
- JS puro, zero binari nativi → portabilità Windows inclusa, in linea con
  l'attenzione cross-platform già presente in `src/process-manager.js`;
- copre il pezzo difficile (log streaming scrollabili) con `TextBox.appendLog`;
- costo extra reale e contenuto: i **tab non sono nativi** e vanno disegnati a
  mano (qui ~15 righe). Tutto il resto è coperto.

OpenTUI resta tecnicamente superiore per ergonomia widget (tab nativi, layout
flex, frame sub-ms) **ma solo se go-dev adottasse Bun come runtime** — decisione
ben più grande e fuori dallo scope di "migliorare la fruibilità con una TUI".

> Da rivalutare se/quando OpenTUI abiliterà il backend FFI per Node
> ("...not available for this runtime **yet**").
