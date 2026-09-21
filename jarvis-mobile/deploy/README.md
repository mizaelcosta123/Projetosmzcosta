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

**Não provado:** o build da imagem (este ambiente não tem daemon Docker) e a
chamada de rede ao `openrouter.ai` (bloqueada pelo proxy daqui). A receita
dentro do Dockerfile é a mesma sequência que rodou neste container; o caminho de
rede foi provado contra um backend compatível com OpenAI local.

Se o build falhar, a primeira suspeita é o `pip install` do `pydantic` na imagem
slim — `apt-get install build-essential` antes dele resolve.

## Um detalhe sobre qual motor atende

Com uma chave de OpenRouter presente, o OpenJarvis registra **dois** caminhos
para ele: o motor de nuvem embutido e o preset que este pacote adiciona. A
descoberta monta um `multi` e o embutido costuma atender. Funciona igual para
conversar; a diferença é que o campo `cost_tier` do auto router passa pelo
preset, não pelo embutido. Se quiser garantir o preset, rode com
`--engine openrouter`.
