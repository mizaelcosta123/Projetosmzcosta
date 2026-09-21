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

## 2. Rodar tudo no computador — uns 5 minutos

Mais rápido de diagnosticar que no celular, e o que quebra aqui quebraria lá.

```bash
git clone https://github.com/open-jarvis/OpenJarvis ~/openjarvis
git clone https://github.com/mizaelcosta123/Projetosmzcosta ~/mzc

python3 -m venv ~/jarvis-venv
~/jarvis-venv/bin/pip install click croniter httpx rich tomlkit websockets pyyaml \
                              fastapi uvicorn python-multipart pydantic
~/jarvis-venv/bin/pip install --no-deps ~/openjarvis
~/jarvis-venv/bin/pip install ~/mzc/jarvis-mobile

# Coloca a interface dentro do servidor, para página e API dividirem a origem.
~/jarvis-venv/bin/python -m jarvis_mobile.deploy --source ~/mzc/jarvis-mobile/web

export OPENROUTER_API_KEY="sua-chave"
~/jarvis-venv/bin/jarvis serve --engine openrouter --model anthropic/claude-sonnet-4.5
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

## Quando algo falha

| Sintoma | O que é |
|---|---|
| `pydantic` falha ao compilar | Falta toolchain: `pkg install rust clang binutils make`. Em aparelho com pouca memória o build também morre — feche apps e repita. |
| `No inference engine available` | Chave ausente ou inválida. O servidor testa o provedor antes de subir e recusa sem nenhum saudável. |
| `Another server is already registered` | O OpenJarvis guarda um PID único. Encerre o processo anterior antes de subir outro. |
| A página abre mas o chat dá erro | Se você abriu a interface de outra origem que não o próprio servidor, é CORS. Use a que o `jarvis serve` entrega. |
| Pedi o rosto e nada aconteceu | A troca chega por WebSocket em `/v1/agents/events`. Se o modelo não chamou a tool, o botão de forma continua funcionando. |
| `O servidor não disse qual modelo usar` | Preencha **Configurações → Modelo**. Com OpenRouter os IDs são `vendor/modelo`, por exemplo `anthropic/claude-sonnet-4.5`. |

### Sobre o OpenRouter

Os IDs são namespaced (`vendor/modelo`) e o catálogo tem centenas de entradas,
então vale nomear o que você quer em vez de esperar um padrão servir. A
interface pergunta ao `/v1/info` qual modelo o servidor está configurado para
usar — o campo **Modelo** só é necessário se você quiser outro.

Confira sua chave antes de instalar qualquer coisa:

```bash
curl https://openrouter.ai/api/v1/models \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" | head -c 200
```

Se isso devolver JSON, a chave está boa.

## O que foi verificado aqui

A cadeia inteira foi percorrida em Linux antes de escrever este guia: instalação
com o conjunto mínimo, `jarvis serve` no ar, a interface servida pelo próprio
servidor, e uma resposta com streaming chegando na legenda pelo navegador, sem
erro de console.

**O que não foi:** nada disso rodou em Android de verdade. A análise de
dependências é real, mas o que é específico do Termux — bionic, versão de
kernel, o build do `pydantic-core` no seu aparelho — só o seu celular decide. O
instalador para e diz o que faltou em vez de fingir que deu certo.
