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
~/jarvis-venv/bin/jarvis serve --engine ollama --model qwen2.5-coder:1.5b
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

Uma ressalva sobre o `qwen2.5-coder:1.5b`: com 1,5 bilhão de parâmetros e
treinado para código, ele conversa, mas chamar tools de forma confiável é outra
exigência. O agente `orchestrator` depende disso — se ele não trocar de rosto
quando você pedir, é o modelo, não a interface. Um modelo maior com tool calling
resolve; os botões continuam funcionando enquanto isso.

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
