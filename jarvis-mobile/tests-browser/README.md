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
| `barge.mjs` | uma voz **abaixa** o volume dele e as palavras o **param**, nessa ordem; um som recorrente sem palavras abaixa e volta, repetidamente, sem nunca pará-lo |

O segundo é o que vale mais: é a diferença entre "qualquer barulho interrompe"
e "ele jamais para de responder, a não ser se for fala".
