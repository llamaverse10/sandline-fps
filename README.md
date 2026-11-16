# sandline-fps

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/llamaverse10/sandline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/llamaverse10/sandline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

SANDLINE is a round-based tactical FPS in three.js: 5v5 bomb plant/defuse at a desert freight outpost at dusk, three lanes (A rail line, mid crates, B alley), a buy economy, six weapons, and bot teammates and opponents. First to 8 rounds.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome and click Play. WASD move, mouse look, B buy menu, E plant/defuse, G frag grenade, R reload, Ctrl crouch, Space jump.

## The game

- **Map**: a 64×48 m freight outpost — A lane along the rail cars, mid with crates and an elevated platform, B alley to the south, and the Depot bombsite in the east.
- **Rounds**: freeze (3 s) + buy (15 s), then 100 s live. Plant the bomb at the Depot and defend it, or eliminate the other team. Win a round: +$3250; lose: +$1900; kill: +$300; plant: +$300.
- **Weapons**: P9 sidearm, VK-47 ($2700), MR-4 ($3100), Kestrel SMG ($1500), Longbow sniper ($4750), frag grenade ($300), kevlar vest ($650). Start with $800.
- **Bots**: four friendly bots and five enemy bots with waypoint navigation, sight and hearing, holding, investigating, planting and defusing.
- **Tech**: three.js 0.187.0 (vendored), ES modules with no build step, fixed-step 60 Hz simulation, WebAudio synth sound effects, and a DOM HUD.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tvfbjxfd&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
