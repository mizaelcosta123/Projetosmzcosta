# Publicar o backend

Rodar o servidor fora do celular resolve o problema mais chato do stack: o
telefone deixa de precisar do Termux, do Ollama e da rede local — ele só abre
uma URL.

## O que a imagem traz

Servidor, interface e uma voz brasileira, em cerca de 400 MB. É menor que a
imagem do OpenJarvis porque não constrói SPA em React nem extensão Rust, nada
disso usado aqui, e porque o conjunto de dependências é o mesmo medido para
Android — sem `datasets`, sem SDK `openai`.

## Render

```
https://dashboard.render.com/blueprint/new
  ?repo=https://github.com/mizaelcosta123/Projetosmzcosta
```

O `render.yaml` está na **raiz do repositório**, não aqui — o Render só procura
nesse lugar, e numa subpasta ele responde "blueprint não encontrado". Depois do primeiro deploy, defina
`OPENROUTER_API_KEY` no painel — **chave em arquivo versionado é chave vazada**,
por isso ela está marcada `sync: false`.

O blueprint também gera um `OPENJARVIS_API_KEY`. Sem ele o servidor recusa
escutar fora do loopback, que é o comportamento certo para algo na internet
aberta. Guarde esse valor: é ele que você põe em **Configurações → Chave de
API** na interface.

### Variáveis de ambiente: o que é obrigatório e o que não é

Só duas coisas fazem o serviço funcionar. O resto é escolha.

| variável | precisa? | para quê |
|---|---|---|
| `OPENJARVIS_API_KEY` | **sim** | Sem ela o servidor recusa escutar fora do loopback. O blueprint gera uma (`generateValue: true`) — você não digita, só copia o valor gerado para **Configurações → Chave de API** na interface. |
| `OPENROUTER_API_KEY` | **sim, na prática** | É o motor. `sync: false` no blueprint, então o campo aparece em branco e fica em branco se você não preencher. A mesma chave atende o `speak` pelo `openrouter_tts`. **Só aqui.** Chave nunca vai para arquivo do repositório — nem em `config.toml`, nem em `render.yaml`, nem em comentário. Uma chave que entra no histórico do git é uma chave pública, e apagar o commit depois não a apaga. |
| `JARVIS_HOST` / `JARVIS_PORT` | já vêm prontas | `0.0.0.0` e `10000`, definidas no `render.yaml`. Não mexa. |

Opcionais, todas lidas se estiverem presentes:

| variável | o que muda |
|---|---|
| `JARVIS_DEVICE_TOKEN` | Liga a ponte com o celular (veja [Ligar o celular ao backend](#ligar-o-celular-ao-backend)). O blueprint já gera uma. Sem ela a rota nem existe, e as ferramentas de aparelho respondem "nenhum aparelho conectado". |
| `TAVILY_API_KEY` | O `web_search` passa a usar o Tavily, com resultados ranqueados. Sem ela a imagem cai no DuckDuckGo, que já funciona porque o `ddgs` está instalado. |
| `YOUDOTCOM_API_KEY` | Idem, pelo You.com. Sem chave o You.com responde 403 e o fallback entra. |
| `OPENJARVIS_WEB_SEARCH_ENGINE` | Fixa o buscador (`tavily`, `youcom`, `duckduckgo`) em vez de deixar no `auto`. |
| `NOUS_API_KEY` · `HUGGINGFACE_API_KEY` (ou `HF_TOKEN`) · `OPENCODE_API_KEY` | Habilitam os outros presets de provedor. Só valem se você trocar o `default_model` / `preferred_engine` no `config.toml` — com o padrão em `qwen/qwen3.8-27b:free` (OpenRouter) elas ficam paradas. |
| `OPENROUTER_HOST` e afins (`<ENGINE_ID>_HOST`) | Aponta um preset para outro endereço. Serve para testar contra um servidor compatível com OpenAI local. |

**O que NÃO colocar:** nada de `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou
`GEMINI_API_KEY` a menos que você queira mesmo esses provedores — o OpenJarvis
detecta essas variáveis e monta um motor de nuvem adicional, o que só embaralha
qual caminho atende a conversa.

### Duas coisas do plano gratuito que vão te surpreender

**Sem disco persistente.** O Render rejeita um bloco `disk:` num serviço
gratuito — o blueprint nem chega a construir. Por isso ele não tem um. A
consequência: o sistema de arquivos volta ao estado da imagem a cada deploy ou
reinício, e o que se perde é `memory.db` e `traces.db` — histórico e telemetria.
A configuração não se perde, porque está dentro da imagem. Conversar funciona
igual; ele só não lembra de ontem.

Para manter memória, troque `plan: free` por `plan: starter` e acrescente o
bloco `disk:` que está comentado no fim do `render.yaml`.

**Ele dorme.** Serviço gratuito hiberna depois de um tempo sem uso, e a primeira
requisição depois disso leva perto de um minuto para acordar. Da interface isso
parece travamento. Espere, ou mantenha algo pingando `/health`.

## Ligar o celular ao backend

O backend está numa URL pública; o seu celular não está, e nada numa rede móvel
aceita conexão de fora. Então **quem disca é o telefone**: um runner pequeno
roda no Termux, segura um WebSocket aberto com o backend, e o Jarvis manda o
trabalho por ele.

O que trafega é uma **chamada de subprocesso**, não uma ferramenta. As
ferramentas de aparelho já se expressam como `termux-*`, então a ponte carrega
`argv` e devolve código de saída, stdout e stderr. Uma implementação só, que
funciona igual rodando dentro do Termux ou na nuvem.

### No painel do Render

O blueprint gera `JARVIS_DEVICE_TOKEN`. Revele o valor em *Environment* — é o
segredo do aparelho, separado do `OPENJARVIS_API_KEY` de propósito: um deixa
conversar com o assistente, este deixa alcançar o seu celular.

Enquanto nenhum runner conectar, as ferramentas de aparelho só respondem
"nenhum aparelho conectado". Deixar a variável lá não expõe nada sozinho.

### No Termux

O runner é **um arquivo só**, e de propósito: ele não importa nada do
`jarvis_mobile`, então o telefone não precisa carregar o OpenJarvis.

```bash
pkg install python termux-api
pip install websockets

curl -O https://raw.githubusercontent.com/mizaelcosta123/Projetosmzcosta/claude/save-repos-as-skills-8vw6k0/jarvis-mobile/src/jarvis_mobile/bridge/runner.py

export JARVIS_DEVICE_URL=https://jarvis-backend-rhnc.onrender.com
export JARVIS_DEVICE_TOKEN=...          # o valor revelado no Render
python runner.py
```

Instale também o app **Termux:API** pela F-Droid — o pacote `termux-api` é só a
linha de comando; sem o app os helpers não chegam ao Android.

Quando conectar, o log diz o que foi liberado:

```
INFO aparelho pixel — 8 helpers, somente termux-* e am, cat, head
INFO conectado — somente termux-* e am, cat, head
```

### Quem decide o que roda é o aparelho

Esta é a parte que importa. O backend manda `argv`; **nada do lado dele escolhe
o que o seu telefone aceita**. A política está no `runner.py`, onde você pode
ler:

| modo | o que roda |
|---|---|
| padrão | só os helpers `termux-*`, mais `am`, `cat` e `head` — o suficiente para todas as ferramentas de aparelho, e **não** um shell |
| `--allow-shell` | qualquer comando. É o que `device_shell` precisa |
| `--allow git` | libera só aquele comando, sem abrir o shell inteiro |

`--allow-shell` tem que ser digitado no celular. Um token roubado não consegue
se conceder isso.

O caminho é comparado pelo nome do programa, então
`/data/data/com.termux/files/usr/bin/sh` continua sendo `sh`.

### Uma coisa que mudou junto, e você precisa saber

As ferramentas de aparelho declaravam `requires_confirmation`. Parecia proteção
e não era: o executor do OpenJarvis **recusa** uma ferramenta marcada assim
quando não existe callback interativo, e `jarvis serve` nunca tem um. Ou seja,
`device_open`, `device_app_launch` e `device_share` estavam mortas na interface
web — nos dois jeitos de rodar — enquanto pareciam protegidas.

A trava foi para onde funciona: o runner, no aparelho. Um teste fixa isso, para
que religar a flag não volte a desligar as ferramentas em silêncio.

### Manter de pé

Android mata processo parado em segundo plano. Duas medidas:

```bash
termux-wake-lock          # impede o doze de suspender o Termux
```

E instale **Termux:Boot** (F-Droid) com um script em
`~/.termux/boot/jarvis-runner.sh` para ele voltar sozinho depois de reiniciar.
O runner já reconecta sozinho quando a rede cai — elevador, túnel, rádio
dormindo —, com espera crescente até 60s.

### Conferir

Pergunte ao próprio servidor, de qualquer lugar:

```bash
curl -s -H "Authorization: Bearer $OPENJARVIS_API_KEY" \
  https://seu-backend.onrender.com/v1/device
```

```json
{"linked": true, "name": "pixel", "shell": false, "binaries": ["termux-open-url", ...]}
{"linked": false}
```

É a diferença entre "o runner nunca conectou" e "o runner caiu" — que as ferramentas de aparelho não conseguem contar, porque as duas respondem "nenhum aparelho conectado".

No servidor, `jarvis-doctor` mostra a mesma coisa na linha `bridge`:

```
[  ok  ] bridge    pixel linked — 8 helpers, shell allowed
[ warn ] bridge    on, but no phone is linked. In Termux run: ...
[ skip ] bridge    off — set JARVIS_DEVICE_TOKEN on the server and ...
```

Pelo chat, peça alguma coisa do aparelho: *"qual a bateria do meu celular?"*,
*"abre esse link no meu telefone"*, *"o que tem em /sdcard/Download?"*.

## Sua própria máquina ou VPS

```bash
OPENROUTER_API_KEY=sk-or-... docker compose -f deploy/docker-compose.yml up -d
```

O compose publica só em `127.0.0.1` de propósito. Para alcançar de fora, ponha
um proxy reverso com TLS na frente — não troque a porta por `0.0.0.0` e pronto,
porque aí a chave trafega em claro.

## O que foi provado, e o que não

O servidor foi **subido com exatamente esta configuração** e verificado:

| | |
|---|---|
| Recusa `0.0.0.0` sem `OPENJARVIS_API_KEY` | conferido — é por isso que o blueprint gera uma |
| `/v1/info` sem chave | HTTP 401 |
| `/v1/info` com chave | devolve modelo, agente e motor |
| Interface na mesma origem | HTTP 200 |
| Conversa de ponta a ponta | mensagem enviada de um navegador real, resposta na legenda, sem erro de console |

A imagem foi **construída e executada de verdade**, nos dois contextos de build
possíveis (esta pasta e a raiz do repositório). O contêiner respondeu 200 em
`/health`, serviu a interface, e o `HEALTHCHECK` do próprio Docker o marcou
`healthy`.

A ponte com o celular também roda de verdade nos testes: um servidor de fato,
o `runner.py` de fato num subprocesso, e um diretório de `termux-*` falsos
fazendo as vezes do aparelho. Ferramenta → hub → WebSocket → runner →
subprocesso → e a resposta de volta, para bateria, abrir link, notificação,
área de transferência, shell e leitura de arquivo — mais o que acontece quando
um helper falta e quando o aparelho desconecta no meio.

**Não provado:** a camada `apt` (o mirror do Debian é bloqueado pelo proxy deste
ambiente, então o build de teste parte de uma base que já traz o `git`) e a
chamada de rede real ao `openrouter.ai` — essa foi provada contra um backend
compatível com OpenAI local.

### Três erros que já derrubaram este deploy

Todos corrigidos; ficam registrados porque nenhum dos três aparece no código.

1. **`Unable to locate package mbrola`.** O MBROLA mora na área `contrib` do
   Debian — o sintetizador é livre, as vozes de origem não são —, e a imagem
   slim habilita só `main`. O Dockerfile acrescenta a fonte `contrib` antes do
   `apt-get update`, e ainda assim instala o MBROLA numa linha própria que pode
   falhar sem derrubar a imagem.
2. **`ModuleNotFoundError: No module named 'requests'`.** Importar
   `openjarvis.server.app` passa por `research_router` → `research_loop` →
   `hybrid_search` → `connectors.embeddings`, que importa `requests` no topo do
   módulo. Com `httpx` no conjunto mínimo isso parece redundante e não é: sem
   `requests` a CLI funciona, o `jarvis serve` morre antes de abrir a porta, e o
   Render mostra apenas *Failed deploy*. Vale igual no Termux — está no
   `install-termux.sh` e o `jarvis-doctor` avisa.
3. **`"/deploy/config.toml": not found`** ao calcular o checksum de um `COPY`.
   O Render resolveu o caminho contra a **raiz do repositório** mesmo com
   `dockerContext` apontando para esta pasta, e o build só morreu no último
   `COPY`, depois de todos os `pip install`. O Dockerfile deixou de confiar no
   layout: copia o contexto inteiro e **procura** a raiz do pacote lá dentro, o
   que funciona nos dois casos. Se não achar em nenhum, imprime o que o contexto
   tem, em vez de um erro de checksum.

## Um detalhe sobre qual motor atende

Com uma chave de OpenRouter presente, o OpenJarvis registra **dois** caminhos
para ele: o motor de nuvem embutido e o preset que este pacote adiciona. A
descoberta monta um `multi` e o embutido costuma atender. Funciona igual para
conversar; a diferença é que o campo `cost_tier` do auto router passa pelo
preset, não pelo embutido. Se quiser garantir o preset, rode com
`--engine openrouter`.
