# Prisma

Launcher de Minecraft com interface **Liquid Glass** no estilo macOS/iOS, recriado a partir do
código-fonte do [Prism Launcher](https://prismlauncher.org) (GPL-3.0).

A lógica de lançamento segue a do Prism — componentes do `meta.prismlauncher.org`, regras de
bibliotecas, ForgeWrapper para Forge/NeoForge modernos, runtimes Java da Mojang — mas a interface
foi refeita do zero em Electron + React.

## O que tem

- **Janela de vidro**: fundo Acrílico/Mica do Windows 11 (a área de trabalho aparece através da
  janela) ou papel de parede animado; semáforos estilo macOS, tema claro/escuro, 10 cores de destaque.
- **Layout do Prism**: barra lateral, grade de ícones e painel lateral com Jogar / Parar, Editar,
  Mudar grupo, Pasta, Duplicar, Excluir e Criar atalho.
- **Instâncias compatíveis com o Prism**: mesmo formato (`instance.cfg`, `mmc-pack.json`,
  `instgroups.json`). Dá para apontar o Prisma para a pasta de instâncias do Prism e usar as mesmas.
- **Vanilla, Fabric, Quilt, Forge e NeoForge**, incluindo snapshots e versões antigas.
- **Java automático**: detecta instalações e baixa a versão certa (8/17/21/25) quando falta.
- **Contas Microsoft** pelo login oficial (código de dispositivo); tokens criptografados com DPAPI.
- **Modrinth**: busca e instalação de mods, shaders, pacotes de recursos (com dependências) e
  modpacks `.mrpack` completos.
- Mods com ativar/desativar, mundos, capturas de tela, console ao vivo com filtro, ajustes de
  memória/Java/JVM por instância, importação de `.zip` do Prism e `.mrpack` (também arrastando).

## Rodar

Requer Node.js 20+.

```bash
npm install
```

Se o npm não baixar o Electron (npm 11 bloqueia scripts de instalação), rode uma vez:

```bash
node node_modules/electron/install.js
```

Desenvolvimento com recarga automática:

```bash
npm run dev
```

Gerar o instalador para Windows (`dist/`):

```bash
npm run dist
```

## Estrutura

- `src/main/` — processo principal: metadados do Prism, resolução de componentes
  (`minecraft/profile.ts`), downloads, Java, lançamento, contas, Modrinth.
- `src/preload/` — ponte segura (contextIsolation + sandbox).
- `src/renderer/` — interface React; o material de vidro está em `styles/glass.css` e o layout da
  janela em `styles/window.css`.

## Créditos e licença

Baseado no Prism Launcher (e, por herança, MultiMC/PolyMC). Usa os serviços de metadados do Prism,
o ForgeWrapper e a API do Modrinth. O client ID público da Microsoft padrão é o mesmo das builds do
Prism e pode ser trocado em Ajustes → Avançado.

Distribuído sob a **GNU GPL v3** — veja `LICENSE`.
