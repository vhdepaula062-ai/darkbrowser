# DarkBrowser — edição comunitária

Aplicativo Windows com interface em português brasileiro e inglês, perfis isolados e integração com um runtime Chromium incluído no portátil. A distribuição inicia sem perfis e sem proxies. Não inclui contas, cookies, tokens nem os endpoints usados nos testes de desenvolvimento.

## Executar

Extraia todo o `portable.zip` e abra `darkbrowser.exe`. Mantenha as DLLs e a pasta `runtime` ao lado dele. É necessário Windows x64 com WebView2. Os dados de uso são criados na conta do Windows, em `%APPDATA%/darkbyte-ghost-browser`; não compartilhe essa pasta. O executável não tem assinatura digital.

## Editar e compilar

O arquivo de desenvolvimento completo inclui o código React/TypeScript e Rust, os SDKs, o servidor de equipe, o kit visual, Node/npm, o toolchain Rust GNU, MinGW, LLVM, dependências npm e o cache público Cargo. Extraia em um caminho curto, por exemplo `C:/DarkBrowser`.

Abra a pasta no VS Code e execute `scripts/build-windows-fast.ps1` no PowerShell. O script encontra os compiladores em `tools`, usa `.build` como cache e reconstrói o frontend quando suas fontes mudam. `-RebuildFrontend` força a reconstrução da interface. Uma compilação inicial pode demorar; builds posteriores reaproveitam as dependências.

O binário sai em `.build/x86_64-pc-windows-gnu/release/darkbrowser.exe`. Copie-o para a pasta do portátil para usar com o runtime. Para desenvolvimento frontend, use `npm run dev:mock`; para integração desktop, use `npm run tauri dev` com o ambiente de compilação configurado.

## Fuso horário

Escolha o modo automático de fuso no perfil. O launcher consulta a geolocalização através do proxy e exige uma zona IANA para a resolução automática ao vivo. Se os provedores falharem, a política de fallback e o aviso do launcher continuam aplicáveis; você também pode informar uma zona manualmente. Fuso horário não recupera um servidor proxy indisponível.

## Origem e escopo do código

O launcher deriva de ShardBrowser, sob licença MIT; o aviso de copyright original está preservado em `LICENSE`. As alterações DarkBrowser estão neste projeto. Bibliotecas e compiladores mantêm suas próprias licenças nos diretórios incluídos.

O runtime Chromium é distribuído como binário separado. Este arquivo de desenvolvimento contém o código completo do launcher DarkBrowser e suas dependências de build, mas NÃO é uma árvore de fontes completa do Chromium nem contém patches de motor que não tenham sido fornecidos ao projeto. Para modificar o motor é necessário obter a árvore correspondente e seguir o processo de build do Chromium. Fonte pública de referência: https://chromium.googlesource.com/chromium/src ; origem do launcher: https://github.com/ProxyShard/ShardBrowser . Nenhum modelo de IA ou peso de rede neural é necessário para executar o launcher.

## Publicação opcional no GitHub

`scripts/publish-github.ps1 -Owner SEU_USUARIO -Name darkbrowser` cria um repositório público novo usando GitHub CLI (`gh auth login` primeiro). Ele prepara uma cópia apenas dos fontes; ferramentas, caches, perfis e binários grandes ficam fora do Git. Distribua os ZIPs como anexos de uma Release, respeitando os limites de tamanho do serviço. Executar esse script publica o projeto: revise o conteúdo antes. Nenhuma publicação é feita apenas por extrair ou compilar o projeto.
