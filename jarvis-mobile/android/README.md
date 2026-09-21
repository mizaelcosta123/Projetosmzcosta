# O APK

Uma janela para o servidor Jarvis. Deliberadamente fina: a interface já é um app
web servido pelo próprio servidor, então este projeto existe só para dar ao
rosto um ícone na gaveta, tarefa própria nos recentes, e uma janela sem a moldura
do navegador em volta.

Ele não tem lógica própria. Tudo que mostra vem do servidor — o que significa
que **atualizar a interface nunca exige um APK novo**.

## Compilar

Precisa do SDK do Android (`ANDROID_HOME` apontando para ele) e JDK 17.

```bash
cd jarvis-mobile/android
./gradlew assembleDebug
```

O APK sai em `app/build/outputs/apk/debug/app-debug.apk`. Instale com
`adb install` ou copie para o celular e abra.

Para uma versão assinada, gere uma keystore e rode `assembleRelease` — o
`build.gradle.kts` não fixa credencial nenhuma de propósito.

## O que ele precisa que já esteja rodando

O servidor. O APK aponta para `http://127.0.0.1:8000` por padrão, que é o Jarvis
rodando no Termux **neste mesmo celular**. Se ele não responder, o app mostra
como iniciá-lo e um botão para mudar o endereço — útil quando o servidor está
noutra máquina da rede, ou hospedado.

## Três decisões dentro dele

**Texto em claro só no loopback.** O `network_security_config.xml` permite HTTP
sem TLS apenas para `127.0.0.1` e `localhost`. Um backend alcançado pela rede
carrega chave de API, e mandar isso em claro entrega a chave para qualquer um no
mesmo Wi-Fi.

**`mediaPlaybackRequiresUserGesture = false`.** O rosto fala assim que a resposta
chega, sem toque no meio — tratar isso como gesto do usuário anularia o ponto.

**`domStorageEnabled = true`.** O `localStorage` guarda o endereço do servidor e
a preferência de voz. Vem desligado num WebView, e sem ele a interface esquece
tudo a cada abertura.

## Vale a pena?

Honestamente: pouco, hoje. A interface já instala na tela inicial pelo navegador
e funciona igual. O APK dá ícone próprio, ausência de barra de endereço e uma
entrada separada nos recentes — e é a base para o que um PWA não alcança, como
serviço em primeiro plano ou notificação nativa. Se nada disso te faz falta, o
atalho do navegador já resolve.
