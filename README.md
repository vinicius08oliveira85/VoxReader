# 📖 VoxReader — Leitor de e-Pub → Audiobook (PWA)

Transforme seus e-Pubs em audiobooks com **vozes neurais hiper-realistas** (Microsoft Edge TTS),
cache local inteligente em **IndexedDB** e funcionamento **offline** como PWA instalável.

![stack](https://img.shields.io/badge/stack-HTML5%20%2B%20Tailwind%20%2B%20JS%20ESM-6366f1)
![deps](https://img.shields.io/badge/depend%C3%AAncias%20de%20build-zero-success)

---

## ✨ Recursos

| Área | Detalhes |
|---|---|
| 📚 Leitor e-Pub | Import drag-and-drop, TOC, capítulos, texto limpo, capa |
| 🎙️ Vozes neurais | Edge TTS (`pt-BR-FranciscaNeural`, `Antonio`, +20 vozes) via WebSocket direto do browser com token `Sec-MS-GEC` |
| 🎭 Escolha de voz | Filtros por **Melhor para** (Narrativa, Conversacional, Personagens, Educacional, Entretenimento), **Idade** (Jovem, Meia-idade, Sênior) e **Gênero**, com **prévia de áudio** antes de aplicar |
| 🎚️ Prosódia por contexto | Cada contexto ajusta velocidade/tom (ex.: Narrativa −4% vel.; Personagens +6Hz tom) e entra na chave de cache |
| 🔠 Tipografia | Controle A−/A+ do tamanho do texto (13–26px), persistido por dispositivo |
| 🧠 IA (opcional) | Gemini Free Tier para limpar notas de rodapé/nº de página e formatar pausas antes da narração |
| 💾 Cache quota-aware | Cada segmento de áudio (MP3) + texto salvos no IndexedDB; TTS só é chamado se não houver cache |
| 🔌 Fallbacks em cascata | Edge TTS → bridge local `/api/tts` → Web Speech API do navegador |
| ⏯️ Player | Botão único Play/Pause/Retomar com spinner de geração, ±10s reais, velocidade 0.75×–2×, capítulo, voz, atalhos de teclado |
| 🖍️ Highlight | Parágrafo ativo + palavra destacada sincronizada com o áudio |
| 🔗 Compartilhar | `share_target` do PWA: compartilhar um `.epub` de outro app abre o VoxReader já com o livro importado |
| 📖 Leitura contínua | Avanço automático de capítulo (padrão ligado) e pausa configurável entre parágrafos |
| 📦 PWA | `manifest.json` completo, service worker com precache, instalável, offline |
| 🗄️ Gerenciador | Uso de armazenamento, áudio por livro, minutos ouvidos, deleção de cache |

## ⌨️ Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | Play/Pause |
| `←` / `→` | Voltar / avançar 10s |
| Clique no parágrafo | Pula a narração para aquele trecho |

## 📲 Receber livros por compartilhamento

O `manifest.json` declara um `share_target` para `.epub`. Ao compartilhar um livro
de outro app no Android/Chrome, o VoxReader abre e importa automaticamente.

O fluxo passa pelo servidor local porque o Web Share API não entrega arquivos a
uma PWA já aberta:

1. `POST /` recebe o arquivo (multipart, limite de 64 MB) e grava em
   `%TEMP%/voxreader-share/<id>`, respondendo `303` para `/?share=<id>`.
2. `GET /share/<id>` devolve o arquivo uma vez; o app o importa e **cria o
   `DELETE`** para apagar o temporário.
3. Arquivos órfãos expiram em 10 minutos (varredura a cada 5).

O service worker nunca intercepta `/share/` — o arquivo é one-shot e o cache
faria o app reimportar algo já descartado no backend.

## 🚀 Como rodar

```bash
# 1. (opcional, mas recomendado) habilita a bridge TTS local
npm install        # instala apenas "ws" como optionalDependency

# 2. iniciar
npm start          # → http://localhost:8080
```

> **Precisa ser `localhost` ou HTTPS** para Service Worker e instalação PWA.
> O servidor incluso (`server.js`, zero dependências obrigatórias) já serve o app,
> faz fallback SPA e expõe `POST /api/tts`.

### Instalar como app
- **Chrome/Edge (desktop):** ícone “Instalar app” no cabeçalho, ou ícone na barra de endereço.
- **Android:** menu ⋮ → “Adicionar à tela inicial”.
- **iOS Safari:** Compartilhar → “Adicionar à Tela de Início”.

## 🏗️ Arquitetura

```
index.html                Shell único (SPA)
manifest.json             PWA manifest (ícones, atalhos, standalone)
sw.js                     Service Worker — precache do shell + offline
server.js                 Estático zero-dep + bridge opcional /api/tts (Node)
tools/gen-icons.js        Gerador de ícones PNG (sem deps)
vendor/                   epub.js, JSZip, localforage, Tailwind (locais)
src/
  app.js                  Orquestração: telas, import, player, PWA
  services/
    epubParser.js         epub.js → TOC/capítulos/texto/capa
    textCleaner.js        Limpeza regex + Gemini opcional + segmentação
    ttsEngine.js          Edge TTS (WebSocket+GEC) → proxy → Web Speech
    player.js             Fila de segmentos, seek, velocidade, highlight
    storage.js            IndexedDB (localforage): livros/texto/áudio/manifests
    ui.js                 Componentes de UI (cards, reader, player bar, modais)
```

### Fluxo de economia de quota
1. Ao tocar ▶, o `player` consulta `storage.getAudioSegment(bookId, cap, voz, seg)`.
2. **Cache hit** → reproduz o Blob local. Zero rede, zero tokens.
3. **Cache miss** → `ttsEngine.synthesize()` (Edge → proxy) → salva Blob + duração no manifest.
4. O próximo segmento é **pré-buscado** em background para reprodução contínua.
5. O botão ⬇ no player baixa o capítulo inteiro (útil antes de viajar/offline).

A chave do cache é `(bookId, capítulo, voz, segmento)`, e `voz` inclui voz +
contexto de prosódia. Trocar a prosódia **não** invalida o áudio de outro contexto.
Ao sobrescrever um segmento já existente, o contador de uso soma só a **diferença**
de bytes — sem isso, regerar um capítulo inflaria o total exibido no painel.

### Estratégias do service worker
| Recurso | Estratégia |
|---|---|
| Shell (`/`, `/src/`, `/vendor/`, `/icons/`) | cache-first (precache) |
| Navegações | rede primeiro, cache como fallback offline |
| Demais same-origin | rede primeiro, cache como fallback |
| `/api/tts` e `/share/` | **só rede** — áudio fica no IndexedDB, share é one-shot |
| Cross-origin (só `speech.platform.bing.com` e Gemini) | rede primeiro, cache como fallback |

O `RUNTIME_CACHE` é podado em FIFO (120 entradas) para não crescer até o
navegador despejar tudo em storage pressure.

### Token Sec-MS-GEC (Edge TTS)
Mesmo algoritmo do projeto [`edge-tts`](https://github.com/rany2/edge-tts):

```
ticks  = unix_now + 11644473600      # época Windows (1601)
ticks -= ticks % 300                 # janela de 5 min
ticks *= 10_000_000                  # intervalos de 100 ns
token  = SHA256("{ticks}6A5AA1D4EAFF4E9FB37E23D68491D6F4").hex().upper()
```

Se a Microsoft mudar regras/headers, o app degrada graciosamente:
`WebSocket direto → bridge /api/tts → Web Speech API`. **Nenhum modo deixa de funcionar.**

## 🔐 Privacidade
- Livros, textos e áudios ficam **somente no seu dispositivo** (IndexedDB).
- Nenhum servidor nosso existe; a única rede usada é a do próprio Edge TTS/Google
  (chave Gemini opcional, só se você ativar).
- Ative “armazenamento persistente” quando o navegador perguntar (o app solicita sozinho).
- Ao compartilhar um livro, o arquivo passa **temporariamente** por
  `%TEMP%/voxreader-share/` no servidor local e é apagado assim que o app importa
  (ou, no máximo, após 10 minutos).

## 🧪 Testes

```bash
npm test              # suíte offline: texto, timings, SSML e contabilidade
npm run test:epub     # gera um .epub de teste em test/
```

A suíte roda em Node puro, sem rede e sem servidor. O `test/storage.test.js`
fornece um `localStorage` em memória para exercitar a camada de chaves e
contadores do IndexedDB.

## 🛠️ Solução de problemas
- **“modo offline (voz do sistema)”** — Edge TTS bloqueado na sua rede/país; instale `ws` e use via `npm start` para ativar a bridge local.
- **Livro não aparece** — verifique se o arquivo tem extensão `.epub` (não é um `.zip` renomeado de outro formato).
- **Quota cheia** — apague o áudio em cache de livros antigos no painel “Armazenamento” do leitor.
- **Compartilhamento não abre o livro** — o fluxo depende do servidor local (`npm start`); sem ele não há para onde enviar o arquivo.

---

MIT © 2026 — feito com ☕ e IA.
