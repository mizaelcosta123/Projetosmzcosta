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

O `render.yaml` já descreve o serviço. Depois do primeiro deploy, defina
`OPENROUTER_API_KEY` no painel — **chave em arquivo versionado é chave vazada**,
por isso ela está marcada `sync: false`.

O blueprint também gera um `OPENJARVIS_API_KEY`. Sem ele o servidor recusa
escutar fora do loopback, que é o comportamento certo para algo na internet
aberta. Guarde esse valor: é ele que você põe em **Configurações → Chave de
API** na interface.

## Sua própria máquina ou VPS

```bash
OPENROUTER_API_KEY=sk-or-... docker compose -f deploy/docker-compose.yml up -d
```

O compose publica só em `127.0.0.1` de propósito. Para alcançar de fora, ponha
um proxy reverso com TLS na frente — não troque a porta por `0.0.0.0` e pronto,
porque aí a chave trafega em claro.

## Não verificado

A imagem **não foi construída**: este ambiente não tem daemon Docker. O que está
provado é a receita dentro dela — a lista de dependências, o `--no-deps`, a
instalação das vozes e o deploy da interface são exatamente os comandos que
rodaram neste container e funcionaram. O que falta confirmar é o build em si.

Se falhar, a primeira suspeita é o `pip install` do `pydantic` na imagem slim;
`apt-get install build-essential` antes dele resolve.
