# Como testar

Três níveis, do mais rápido ao mais completo. Comece pelo que responde a sua
pergunta agora.

---

## 1. Ver a interface — 10 segundos, sem instalar nada

Abra a página publicada no celular:

**<https://claude.ai/artifact/Y2RapdZj7PuTJZhQVZecbm>**

Toque em **Falar**: ele assume o rosto e as partículas se movem com a voz do
navegador. Os botões **Esfera** e **Rosto** trocam a forma na mão.

Isso é só a interface, sem cérebro por trás — a voz vem do navegador, não de um
modelo. Serve para responder "o visual está certo?".

## 1b. Ouvir a voz local — sem chave, sem internet

```bash
sudo apt install espeak-ng mbrola          # ou: pkg install espeak-ng (Termux)
git clone https://github.com/felipefacundes/brasiltts ~/brasiltts
~/jarvis-venv/bin/python -m jarvis_mobile.speech.install_voices --source ~/brasiltts
```

Três vozes brasileiras: **Angêlô** (masculina), **Maricota** (feminina) e
**Nordestino**. São vozes MBROLA — alguns megabytes de difones, sem modelo, sem
GPU, sem rede.

Só a voz da nuvem soa melhor; a local é a que continua funcionando sem sinal. É
por isso que existem as duas, e o `speak` escolhe a que estiver pronta.

No Termux o `mbrola` precisa ser compilado uma vez para aarch64 — os pacotes do
brasiltts são Arch x86_64, e só os **dados de voz** de dentro deles é que são
portáveis. O instalador avisa e mostra o comando.

## 2. Rodar tudo no computador — uns 5 minutos

Mais rápido de diagnosticar que no celular, e o que quebra aqui quebraria lá.

```bash
git clone https://github.com/open-jarvis/OpenJarvis ~/openjarvis
git clone https://github.com/mizaelcosta123/Projetosmzcosta ~/mzc

python3 -m venv ~/jarvis-venv
~/jarvis-venv/bin/pip install click croniter httpx rich tomlkit websockets pyyaml \
                              fastapi uvicorn python-multipart pydantic requests
~/jarvis-venv/bin/pip install --no-deps ~/openjarvis
~/jarvis-venv/bin/pip install ~/mzc/jarvis-mobile

# Coloca a interface dentro do servidor, para página e API dividirem a origem.
~/jarvis-venv/bin/python -m jarvis_mobile.deploy --source ~/mzc/jarvis-mobile/web

export OPENROUTER_API_KEY="sua-chave"
~/jarvis-venv/bin/python -m jarvis_mobile.check      # confere antes de subir
~/jarvis-venv/bin/jarvis serve --engine openrouter --model openrouter/auto
```

Abra <http://127.0.0.1:8000>. Se a chave estiver certa, ele responde de verdade.

O `--no-deps` é proposital: as dependências declaradas do OpenJarvis puxam
`datasets` e o SDK `openai`, que são exatamente o que evitamos.

## 3. No celular, via Termux — de 20 a 40 minutos

```bash
pkg install -y curl
curl -fsSL https://raw.githubusercontent.com/mizaelcosta123/Projetosmzcosta/claude/save-repos-as-skills-8vw6k0/jarvis-mobile/install-termux.sh | bash
```

Depois:

1. Cole sua chave em `~/.jarvis-env` (o arquivo já vem com as linhas comentadas)
2. `jarvis-start`
3. Abra <http://127.0.0.1:8000> no navegador do celular
4. Menu do navegador → **Adicionar à tela inicial**. Abre como aplicativo.

Peça a ele para mostrar o rosto e ele mostra — a troca de forma é uma tool, não
uma lista de frases.

### Requisitos

- **Termux do F-Droid.** A versão da Play Store está abandonada e não funciona.
- **Termux:API** (o app no F-Droid **e** `pkg install termux-api`) para as tools
  de dispositivo. Sem isso o resto funciona; só some o acesso ao aparelho.

---

## Quando nada funciona

```bash
~/jarvis-venv/bin/python -m jarvis_mobile.doctor --engine ollama
```

Percorre a cadeia inteira **na ordem em que as coisas quebram** e aponta a
primeira falha, com o comando que resolve. "Não conecta de jeito nenhum" vira um
alvo específico.

```
[  ok  ] OpenJarvis          importable
[  ok  ] plugin              4 providers, 8 tools registered
[  ok  ] server deps         fastapi, uvicorn, pydantic present
[  ok  ] interface           deployed to …/server/static
[ fail ] ollama · http://localhost:11434   unreachable …
```

A ordem importa: um pacote que não carrega explica todas as falhas depois dele,
então consertar a primeira costuma apagar o resto.

### Usando Ollama em vez da nuvem

```bash
~/jarvis-venv/bin/jarvis serve --engine ollama --model qwen2.5:1.5b
```

**Se o Ollama roda em outra máquina que não a do Jarvis** — o caso silencioso —
duas coisas precisam ser verdade:

```bash
# na máquina do Ollama:
OLLAMA_HOST=0.0.0.0 ollama serve

# onde o Jarvis roda:
export OLLAMA_HOST=http://192.168.x.x:11434
```

Sem o `0.0.0.0`, o Ollama só aceita conexões da própria máquina, e do celular
parece que ele simplesmente não existe.

**O Jarvis no Render não alcança o seu Ollama.** `localhost:11434` lá dentro é
o próprio contêiner do Render, não o seu aparelho — e a sua casa não tem
endereço fixo para ele chamar de volta. Ollama e Jarvis precisam estar do mesmo
lado da rede, o que na prática dá duas montagens:

| | onde roda o Jarvis | como o aparelho é controlado |
|---|---|---|
| **tudo no celular** | Termux, com `--engine ollama` | direto: as tools `device_*` rodam localmente, sem ponte, sem token, sem WebSocket |
| **nuvem** | Render, com engine de nuvem | pela ponte: o `runner.py` no Termux mantém a conexão aberta |

A primeira é a mais curta para automatizar o aparelho — não há rede entre o
agente e o telefone, porque são a mesma máquina. Custa a memória do modelo e a
bateria. A segunda responde mais rápido e funciona com o celular no bolso, mas
depende da ponte estar ligada.

### Ligar a página ao Ollama do seu Termux

No painel de configurações há um botão **Ollama do Termux**. Ele cria uma
entrada apontando para `http://localhost:11434` — que, do navegador do próprio
aparelho, é o Ollama rodando ali dentro.

Isso funciona mesmo com a página vindo do Render por https: o Chrome não
bloqueia `http://localhost` como conteúdo misto. O que ele bloqueia é o CORS, e
é aí que quase todo mundo trava. O Ollama só aceita chamadas da própria
máquina, então precisa ser dito para aceitar esta página:

```bash
# no Termux, no lugar de `ollama serve`:
OLLAMA_ORIGINS=https://jarvis-backend-rhnc.onrender.com ollama serve
```

Sem isso o navegador recusa antes de qualquer resposta, e reporta apenas
`Failed to fetch` — sem dizer o motivo nem o campo. O botão **Testar e carregar
modelos** traduz isso para o comando acima, já com o seu endereço.

**Mas leia esta parte.** Uma entrada de Ollama é um **provedor**: ela responde e
nada mais. As ferramentas `device_*` vivem no agente do Jarvis, não no modelo,
então nada dessa ligação chega ao Termux por mais que o modelo saiba chamar
tools. O painel diz isso em âmbar ao lado da entrada.

Para ter **modelo local e controle do aparelho ao mesmo tempo**, o Jarvis
precisa rodar no próprio celular:

```bash
~/jarvis-venv/bin/jarvis serve --engine ollama --model qwen2.5:1.5b
```

e a página aponta para `http://localhost:8000` — uma entrada de Jarvis, em
verde. Aí não há rede entre o agente e o telefone, porque são a mesma máquina:
sem ponte, sem token, sem 403.

### O modelo precisa saber chamar tools

Toda tool `device_*` chega ao celular por uma **chamada de tool**. Um modelo que
não sabe fazer isso não avisa: ele responde em prosa, convincente, sobre um
aparelho em que nunca tocou. De fora, isso é idêntico a uma ponte quebrada — e
manda você procurar o defeito no lugar errado.

Os modelos `-coder` são a armadilha comum. Foram treinados para continuar
código, não para escolher uma tool e preencher os argumentos dela, e vários nem
anunciam a capacidade. `qwen2.5-coder:1.5b` é um deles.

O doctor pergunta isso direto ao Ollama, antes de qualquer adivinhação:

```bash
~/jarvis-venv/bin/python -m jarvis_mobile.doctor --engine ollama --model qwen2.5-coder:1.5b
```

```
[  ok  ] ollama · http://localhost:11434    2 models: qwen2.5-coder:1.5b, qwen2.5:1.5b
[ fail ] tool calling                       qwen2.5-coder:1.5b cannot call tools, so no
                                            device_* tool will ever run …
```

Sem `--model`, ele pergunta sobre **todos** os modelos baixados e diz quais
servem — que costuma ser a resposta útil.

### O que cabe num celular

O `-coder` e o normal **do mesmo tamanho pesam o mesmo**. Trocar um pelo outro
não custa memória nenhuma; custa só o download.

| modelo | tamanho | chama tools |
|---|---|---|
| `qwen2.5-coder:1.5b` | ~1 GB | **não** |
| `qwen2.5:1.5b` | ~1 GB | sim |
| `qwen2.5:0.5b` | ~400 MB | sim, mas erra bastante |
| `llama3.2:1b` | ~1,3 GB | sim |

`qwen2.5:1.5b` é a troca direta: mesmo peso do `-coder` que você já tem, e sabe
chamar tools. `qwen2.5:0.5b` é o piso — cabe em quase tudo, mas 500 milhões de
parâmetros escolhendo a tool certa e preenchendo os argumentos erra o bastante
para irritar.

Anunciar a capacidade e acertar são coisas diferentes: quanto menor o modelo,
mais ele confunde qual tool usar. A tabela diz quem sabe tentar, não quem
acerta sempre. Em caso de dúvida, pergunte ao seu próprio Ollama — é o que o
doctor faz, e ele responde sobre os modelos que você realmente tem.

## Permissões do Android

Este é o problema que mais custa tempo, porque o Termux:API **não avisa** que
uma permissão foi negada. `termux-camera-photo` sem permissão de câmera falha do
jeito que um comando quebrado falha, e o assistente repassa isso para alguém que
não tem motivo nenhum para suspeitar que existe uma tela de ajustes envolvida.

Pergunte a ele: *"confira as permissões do meu aparelho"*. A ferramenta
`device_permissions` testa as seis de uma vez e diz o que falta:

```
Liberado: storage, contacts.

Falta liberar:
  · Câmera: Ajustes do Android → Apps → Termux:API → Permissões → Câmera → Permitir.
  · Microfone: Ajustes do Android → Apps → Termux:API → Permissões → Microfone → Permitir.
```

Só **armazenamento** se resolve por comando:

```bash
termux-setup-storage    # e aceite o pedido que aparece
```

As outras cinco são a mesma tela de ajustes do Android, uma por permissão. Não
há comando: o Android exige o toque de uma pessoa.

| permissão | para quê |
|---|---|
| Armazenamento | ler e escrever arquivos, salvar fotos e capturas de tela |
| Câmera | `device_photo`, `device_camera_info` |
| Microfone | gravar áudio |
| Localização | `device_location` |
| Contatos | `device_contacts` |
| SMS | ler a lista de mensagens |

## Controlar a tela

As ferramentas de tela — tocar, arrastar, digitar, ler o que está nela, tirar
print — usam `input`, `uiautomator` e `screencap`, que são binários do **Android**
e não helpers do Termux. O runner recusa isso por padrão, de propósito: `input
tap` consegue apertar qualquer botão do seu celular, inclusive os que gastam
dinheiro.

```bash
python runner.py --url … --token … --allow-ui
```

`--allow-ui` libera a tela e nada mais; `--allow-shell` libera tudo. Como as
duas, isso tem que ser digitado **no celular** — quem tem o token do backend não
consegue se conceder isso sozinho.

Com a tela liberada, o fluxo que faz ele operar qualquer app é:

```
device_ui_dump   → o que está na tela, com as coordenadas
device_tap       → toca no que ele encontrou
device_type      → escreve no campo
device_ui_dump   → confere o que mudou
```

`device_screenshot` salva a imagem, mas **ele não consegue vê-la** — o resultado
de uma ferramenta é texto. Para saber o que está na tela, quem serve é o
`device_ui_dump`; a captura serve para você ver, via `device_open`.

## Quando algo falha

| Sintoma | O que é |
|---|---|
| `pydantic` falha ao compilar | Falta toolchain: `pkg install rust clang binutils make`. Em aparelho com pouca memória o build também morre — feche apps e repita. |
| `No inference engine available` | Chave ausente ou inválida. O servidor testa o provedor antes de subir e recusa sem nenhum saudável. |
| `Another server is already registered` | O OpenJarvis guarda um PID único. Encerre o processo anterior antes de subir outro. |
| A página abre mas o chat dá erro | Se você abriu a interface de outra origem que não o próprio servidor, é CORS. Use a que o `jarvis serve` entrega. |
| Pedi o rosto e nada aconteceu | A troca chega por WebSocket em `/v1/agents/events`. Se o modelo não chamou a tool, o botão de forma continua funcionando. |
| `O servidor não disse qual modelo usar` | Preencha **Configurações → Modelo** com `openrouter/auto`. |

### Sobre o OpenRouter

Use **`openrouter/auto`**. O catálogo tem centenas de entradas com IDs
namespaced (`vendor/modelo`), e nenhuma escolha fixa serve para tudo — o auto
router decide por prompt, com base no que a comunidade de fato gasta para aquele
tipo de tarefa numa janela de sete dias. Você é cobrado pela tarifa do modelo
que ele escolher, e o campo `cost_tier` (`low`, `medium`, `high`, `xhigh`,
`max`; padrão `low`) limita o quanto isso pode custar.

Numa conversa de vários turnos ele mantém o mesmo modelo enquanto aquele
continuar sendo uma boa escolha, então não troca no meio do raciocínio.

Quer fixar um modelo? Ponha o ID dele no campo **Modelo**. A interface pergunta
ao `/v1/info` qual o servidor está usando, então esse campo só é necessário se
você quiser outro.

### Escolher entre os modelos gratuitos

```bash
~/jarvis-venv/bin/python -m jarvis_mobile.models --refresh
```

Isso busca o catálogo do OpenRouter, fica só com os que custam zero na entrada
**e** na saída, e escreve a lista ao lado da interface. Eles passam a aparecer
como sugestões em **Configurações → Modelo** — e o campo continua aceitando
qualquer ID digitado.

Sem `--refresh` ele só imprime a lista no terminal, sem mexer em nada.

A lista não está fixa no código de propósito: modelos gratuitos entram e saem
toda semana, e alguns já vêm com data de remoção anunciada. Um ID fixo aqui
falharia na hora da requisição sem explicar por quê. Rode o comando de novo
quando quiser uma lista atual.

Confira a conexão antes de instalar o resto:

```bash
~/jarvis-venv/bin/python -m jarvis_mobile.check
```

Ele verifica a chave, alcança o catálogo e **manda uma requisição de verdade**
— a única que prova que a cobrança também funciona. Com o `openrouter/auto`,
ele informa qual modelo de fato respondeu, então "auto" deixa de ser caixa
preta e vira algo que você confere contra a fatura.

```
[  ok   ] api key                    key found, ending …123456
[  ok   ] catalogue                  312 models reachable, 18 of them free
[  ok   ] chat · openrouter/auto     replied 'ok' (routed to …), 21 tokens
```

A chave nunca é impressa inteira — só os últimos seis caracteres, o bastante
para distinguir duas.

## O que foi verificado aqui

A cadeia inteira foi percorrida em Linux antes de escrever este guia: instalação
com o conjunto mínimo, `jarvis serve` no ar, a interface servida pelo próprio
servidor, e uma resposta com streaming chegando na legenda pelo navegador, sem
erro de console.

**O que não foi:** nada disso rodou em Android de verdade. A análise de
dependências é real, mas o que é específico do Termux — bionic, versão de
kernel, o build do `pydantic-core` no seu aparelho — só o seu celular decide. O
instalador para e diz o que faltou em vez de fingir que deu certo.
