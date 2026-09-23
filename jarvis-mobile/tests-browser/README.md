# Testes de navegador

O que `node --test "tests-web/*.test.mjs"` não alcança: microfone, canvas, módulos ES
resolvendo uns aos outros. Ficam **fora** da suíte padrão de propósito — pedem
Playwright e um Chromium, e a suíte padrão não pede nada.

O microfone é real do ponto de vista da página: o Chromium toca um WAV dentro
do `getUserMedia`, então o medidor de nível, o detector de voz e o corte de
fala rodam de verdade. Só o reconhecedor é substituído — o do Chrome depende
do serviço do Google —, e isso é uma vantagem: o teste decide quando as
palavras chegam, que é metade do problema.

## Rodar

```bash
python3 tests-browser/make-voice.py /tmp/fala.wav
python -m jarvis_mobile.deploy --source web --target /tmp/estatico
(cd /tmp/estatico && python3 -m http.server 8803 --bind 127.0.0.1 &)

npm i playwright          # numa pasta qualquer; não entra no projeto
node tests-browser/live.mjs  /tmp/fala.wav 8803
node tests-browser/barge.mjs /tmp/fala.wav 8803
```

Sem mais nada, o Playwright usa o Chromium que ele mesmo baixou. Se você já
tem um em outro lugar, aponte: `CHROMIUM=/caminho/para/chrome node ...`.
`SHOT=/tmp/live.png` salva uma captura da tela ao fim do `live.mjs`.

## O que cada um prova

| arquivo | |
|---|---|
| `live.mjs` | a escuta pelo nome começa no primeiro toque; conversa comum não acorda; o nome abre a sessão e a pergunta chega ao modelo **sem o nome dele** (lida do corpo do pedido, não da tela); o medidor reporta voz com áudio real; o botão abre e fecha |
| `attach.mjs` | a câmera abre com um quadro de verdade, a foto entra na bandeja, a câmera é desligada, e a imagem **sai no corpo do pedido** como bloco `image_url` — sem imagem, a mensagem continua sendo uma string |
| `preview.mjs` | a página que o modelo escreveu roda num iframe e **não alcança** a chave: o script tenta ler o localStorage e leva um `SecurityError` |
| `generate.mjs` | o modo criar troca o sentido do campo; o texto chega **codificado** na URL; a imagem é exibida e decodificada; o limite do serviço segura o botão com contador; 429 vira "espere" e 503 vira "ocupado"; desligar o modo volta a conversar |
| `settings.mjs` | o painel de provedores: a lista enche, os modelos carregam sozinhos, o Ollama do Termux entra num toque, trocar de provedor limpa o modelo do outro, um endereço morto diz o que fazer. É tudo fiação de DOM, que teste de unidade não alcança |
| `look.mjs` | como ele fica parado e falando, nas duas formas, num tamanho de celular de verdade — quatro PNGs para comparar. É o que os números não dizem: se ainda parece ele, e se a expansão sai pela lateral da tela |
| `expressions.mjs` | as nove expressões na mesma folha, e a mesma cara calada e falando. Os testes dizem que `alegre` levanta a bochecha e que 468 partículas se mexeram; não dizem se aquilo parece um sorriso, nem se duas expressões dão para distinguir de relance num celular. Só o olho resolve isso |
| `gaze.mjs` | para onde ele olha e o que a cabeça faz a respeito: olhando para os lados, para cima, para baixo, e revirando os olhos. Os números dizem que a íris andou 0,068; não dizem se aquilo parece alguém olhando. Tem também um recorte só dos olhos, porque em tamanho de cabeça uma íris tem uma dúzia de pontos e "mexeu" vira questão de opinião |
| `local.mjs` | o app inteiro rodando aqui contra um Ollama local: conta **quantas** chamadas faz e **para onde**. É o que teste de unidade não alcança — toda regressão que este arquivo pegou foi uma chamada a um endereço que nunca ia responder (um WebSocket repetindo uma rota que o Ollama não tem, um `/v1/info` 404 antes de cada primeira mensagem) e nenhuma delas quebra nada. Só custam bateria. Precisa de `fake-ollama.mjs` (ou um Ollama de verdade) e do `web/` servido |
| `headers.mjs` | se o navegador chega a **oferecer** o prompt. É o único bug do projeto invisível em desenvolvimento e total em produção: servidor estático não manda `Permissions-Policy`, então a câmera funciona no notebook; o OpenJarvis manda `camera=()`, que não é "pergunte" e sim "nenhuma origem pode, esta inclusive". Serve a página com os cabeçalhos dos dois lados e tenta de verdade |
| `models.mjs` | escolher modelos de um catálogo que pode ter trezentos: abrir com tudo listado, marcar vários, filtrar, e o que foi guardado sobreviver a fechar e reabrir o painel. O `<datalist>` que isso substituiu era inutilizável num celular — só abre no foco, filtra contra uma lista que você não vê, e não guarda nada |
| `holograms.mjs` | conjurar objetos falando, sem rede nenhuma, e segurá-los no palco com o dedo (tocar, arrastar, toque duplo) — o endpoint aponta para uma porta fechada de propósito, então qualquer coisa que alcance a rede falha, e é assim que se prova que o caminho rápido respondeu sozinho. Também o que o app diz sem WebXR, que é a maioria dos aparelhos |
| `routing.mjs` | escolher entre os modelos guardados a partir do que cada um fez de verdade. Dois ids no mesmo endereço, um deles recusado pelo servidor, e ninguém conta ao app qual é qual — ele descobre tentando e para de escolher o que falha. Precisa de requisições, falhas e persistência reais, que é o que teste de unidade não alcança |
| `conjure-tool.mjs` | o modelo criando hologramas: o app abre `/v1/agents/events` (um WebSocket simulado pelo Playwright), desenha o que o `tool_call_end` aceito manda, e **ignora** o início da chamada e uma chamada recusada, que trazem argumentos que ninguém conferiu |
| `place.mjs` | localização e clima lidos do **corpo do pedido** ao modelo: a posição vai arredondada, só numa pergunta sobre lugar ou tempo, e sem permissão nada sai — nem para o Open-Meteo |
| `offline.mjs` | o service worker: guarda o que a página carregou, abre sem rede, deixa passar um arquivo editado (rede primeiro), e notifica só com o app em segundo plano. Roda o Chromium completo em `--headless=new`, porque o headless shell nega toda notificação |
| `lens.mjs` | a realidade aumentada pela câmera: a **foto de uma mão** vira a câmera do Chromium (um MJPEG da própria foto), a página é servida com os **cabeçalhos reais** do servidor e o modelo roda de verdade — os cinco dedos desenhados cada um na sua cor, "mão aberta" lida, um holograma por voz sobre a câmera, a câmera desligada ao sair. Também sem conseguir baixar o modelo, e com o cabeçalho antigo: aí o app manda fazer o deploy, não conferir a conexão. Precisa do pacote npm e do modelo locais (ver o cabeçalho do arquivo) |
| `memory.mjs` | a seção Memória: lista, esquecer uma, exportar (lido do download de verdade), importar pelo seletor de arquivos, e o apelido importado valendo depois de recarregar |
| `barge.mjs` | uma voz **abaixa** o volume dele e as palavras o **param**, nessa ordem; um som recorrente sem palavras abaixa e volta, repetidamente, sem nunca pará-lo |

O segundo é o que vale mais: é a diferença entre "qualquer barulho interrompe"
e "ele jamais para de responder, a não ser se for fala".
