# BASTIÃO — Caçadores de Colossos

Jogo original de ação em 3D (Three.js) com ganchos duplos, gás e lâminas contra gigantes, em estética low-poly blocada.
Mecânicas de locomoção inspiradas no gênero (referência de design: notas de patch públicas do RAoT); todo código, modelos, nomes e arte são próprios.

## Rodar

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

Use Chrome/Edge. Ao iniciar um modo, o jogo entra em tela cheia e trava o teclado (Keyboard Lock) para que **Ctrl** (Reel Out) funcione sem o navegador fechar a aba com Ctrl+W.

## Controles (padrão, remapeáveis em Configurações)

| Tecla | Ação |
|---|---|
| Mouse | Mirar |
| Mouse esq. / dir. | Gancho esquerdo / direito (segure para manter) · **em postura: ataque** |
| F | Postura de ataque (mira verde = lunge disponível; o lunge tira a postura) |
| Espaço | Reel In / gás (preso: puxa para a âncora · solto: jato para frente) |
| Ctrl esq. | Reel Out (solta cabo) · segurar ao tocar o chão = aterrissagem dura |
| Shift esq. | Separar ganchos (abre para os lados da mira) |
| WASD | Andar · no ar: toque duplo (e segure) = burst · preso: balançar |
| E / Q | Subir/pular · Descer/rolar |
| R | Trocar lâminas |
| G | Reabastecer (dentro do posto, feixe dourado) |
| C / V | Sinalizador de fumaça / acústico (atordoa gigantes) |
| T | Emote |
| Tab | Estatísticas |
| Esc | Menu |

## Modos

- **Sobrevivência** — ondas que entram pela brecha da muralha; Colosso a cada 5 ondas; escolha 1 de 3 melhorias por onda.
- **Treino** — bonecos fixos + gigantes lentos, sem morte.
- **Corrida** — circuito de anéis pela cidade, muralha e torre; recorde salvo.
- **Exploração livre** — gigantes vagando.

## Gigantes

Comum, Pequeno, Errante (rápido, salta), Blindado (nuca com placa), Colosso (chefe, explosão de vapor).
Pontos fracos: **nuca** (mata se o dano ≥ limiar), olhos (cega), braços (impede agarrar), pernas (derruba). Membros regeneram.
Dano = velocidade (m/s) × 10.

## Estrutura

```
src/config.js   ajustes de física/gameplay (calibre o feeling aqui)
src/player.js   ganchos, reel, burst, stress, lunge, combate, câmera
src/giants.js   modelos+IA dos gigantes, zonas de dano, agarrão
src/world.js    cidade procedural, muralha, floresta, colisão e raycast
src/effects.js  partículas cúbicas, destroços, arcos de corte
src/audio.js    áudio 100% procedural (WebAudio)
src/hud.js      HUD e radar
src/main.js     modos, ondas, melhorias, menus, teclas
tests/          testes headless (puppeteer-core + Chrome instalado)
```

Testes: com `npm run dev` rodando, `node tests/smoke.mjs` e `node tests/world_nan.mjs`.
