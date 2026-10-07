# Landing OG art

- `landing-exploded.png` — backdrop for `app/opengraph-image.tsx`: the landing's "Host the whole build" step (enclosure exploded), 2× capture of the real 3D scene with the UI hidden. The "M" is painted on at render time.
- `landing-loop.mp4` / `landing-loop.gif` — the same scene looping collapsed → exploded → collapsed (1200×630 crop of a 2× capture, 25fps; 800px GIF). Not wired into `og:video`; see the PR for why. Use them for posts, Discord/Slack uploads, etc.

Regenerating: run the app, load `/`, hide everything but `.mz-landing-stage`, step the scene with a fake rAF clock (deterministic frames), and set `reducedMotion` on `EnclosureScene` so the idle sway and burn sweeps don't fire. Frames → ffmpeg with the the M overlaid.
