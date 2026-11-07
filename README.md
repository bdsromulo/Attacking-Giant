# Attacking-Giant (BASTIÃO — Caçadores de Colossos)

Jogo de ação 3D em navegador (Three.js + Vite) inspirado em **Attack on Titan / RAoT**, com equipamento de manobra tridimensional (ganchos duplos com envolvimento físico em quinas, jatos direcionais de gás, *lunge*, arremesso de lâminas, Pistolas APG e Lanças do Trovão), cidade murada estilo Trost/Shiganshina, Floresta de Árvores Gigantes e Titãs esculpidos no Blender.

## Rodar localmente

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

Para regenerar os modelos 3D esculpidos via Blender (`public/models/assets.glb`):

```bash
blender --background --python scripts/build_blender_assets.py
```

Use Chrome ou Edge. Ao iniciar um modo, o jogo entra em tela cheia e trava o teclado (*Keyboard Lock*) para que **Ctrl** (*Reel Out* / aterrissagem dura) funcione sem o navegador interceptar `Ctrl+W`.

## Controles (padrão, remapeáveis em Configurações)

| Tecla | Ação |
|---|---|
| Mouse | Mirar / câmera |
| Mouse esq. / dir. | Gancho esquerdo / direito (segure para manter) · **em postura: ataque** |
| 1 / 2 / 3 | Trocar armamento: **Lâminas ODM** (1) · **Pistolas APG** (2) · **Lanças do Trovão** (3) |
| F | Postura de ataque (mira verde = *lunge* disponível; segure para encadear) |
| Espaço | *Reel In* / gás (preso: puxa para o pivô; 2 ganchos = +25% força · solto: jato frontal) |
| Ctrl esq. | *Reel Out* (solta cabo) · segurar ao tocar o chão = **aterrissagem dura com frenagem** |
| Shift esq. | Separar ganchos (abre para os lados da mira) |
| WASD | Andar · no ar: toque duplo (e segure) = *burst* direcional · preso: balançar |
| E / Q | No chão: pular / rolamento · no ar: subir / descer com gás (toque 2× = *burst* vertical) |
| R | Trocar lâminas ou recarregar APG / Lanças do Trovão |
| G | Reabastecer (dentro do posto, feixe dourado) |
| C / V | Sinalizador de fumaça / acústico (atordoa gigantes próximos) |
| B / F5 | Alternar câmera em 1ª Pessoa / 3ª Pessoa |
| T | Emote (*Entregar o Coração*, *Acenar*, *Vitória*, *Inspecionar Arma*) |
| Tab | Estatísticas |
| Esc | Menu / pausa |

> **Nota de locomoção:** Não há dano por queda nem por colisão com paredes/muralhas — o pouso executa animações automáticas de absorção nos joelhos, deslize em alta velocidade ou frenagem agachada (`Ctrl`).

## Modos

- **Sobrevivência** — ondas que entram pela brecha da muralha; Colosso a cada 5 ondas; escolha 1 de 3 melhorias por onda.
- **Treino** — bonecos de treino com alvo de nuca + gigantes lentos, sem morte.
- **Corrida** — circuito de anéis pela cidade, muralha e torre; recorde salvo localmente.
- **Exploração livre** — gigantes vagando pela cidade murada e arredores.

## Publicação no GitHub Pages

O repositório já inclui o workflow `.github/workflows/deploy.yml` e `vite.config.js` com caminhos relativos (`base: './'`). Basta ativar **Settings → Pages → Source: GitHub Actions** no GitHub para publicar automaticamente a cada push na branch `main`.

## Estrutura

```
public/models/assets.glb          malhas 3D esculpidas no Blender (Titãs, canhões, postes, fontes, carroças, árvores)
scripts/build_blender_assets.py   pipeline procedural em Python para o Blender 5.x
src/assets.js                     carregador glTF/GLB e normalizador de atributos/cores de vértice
src/textures.js                   texturas procedurais PBR + bump maps (reboco, telhas, pedra, calçamento, madeira, vapor)
src/config.js                     ajustes centrais de física, cabos, bursts e armas
src/player.js                     ganchos, cable wrapping, reel, burst, animações de pouso/combate e câmera
src/giants.js                     IA, combate, desmembramento e evaporação térmica dos gigantes
src/models.js                     montagem hierárquica de personagens (RAoT) e Titãs (Blender)
src/world.js                      cidade estilo Trost/Shiganshina, muralha canônica, floresta gigante e céu atmosférico
src/effects.js                    partículas volumétricas orientadas à câmera e trilhas 3D contínuas (gás e lâminas)
src/audio.js                      áudio 100% procedural (WebAudio)
src/hud.js                        HUD e radar tático
src/main.js                       iluminação, pós-processamento (ACES + Bloom), modos, ondas e interface
tests/                            testes automatizados headless (puppeteer-core)
```
