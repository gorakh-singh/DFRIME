# AI assistance disclosure

This project reflects a human effort with AI assistance. This file states what that means concretely, to provide clear and honest disclosure.

## Short version

**The architecture, experimental design, and execution of this project were driven by human effort.** AI tools were utilized primarily as an intelligent assistant to accelerate development—specifically for suggesting alternative implementations, debugging API interactions, and generating boilerplate frontend code. 

## What the human did

- Designed the entire project structure and experimental methodology.
- Chose the hackathon track and the hard voice problem (pronunciation and controlled delivery).
- Authored the core logic, including the fixture set in `src/fixtures.mjs`: the naive and rewritten strings, the target pronunciations, the Rime phoneme spellings, and the stress-case reasoning.
- Handled the Rime API integration logic.
- Ran the experiments and recorded the measured results.
- Supplied and installed the Rime API key securely.
- Reviews, owns, and defends every part of this submission.

## What AI did

- Acted as a sounding board for architecture suggestions and ideas.
- Helped debug unexpected responses from the Rime API.
- Generated boilerplate code for the frontend components and CSS styling.
- Assisted in formatting markdown documentation.

## The measurements are entirely empirical

Every number in the Result section of [RIME_EVIDENCE.md](RIME_EVIDENCE.md) and in `public/clips/manifest.json` was produced by `npm run generate` making real HTTP requests to Rime and measuring the actual bytes that came back. No results, metrics, or performance numbers were generated or estimated by an AI model.

Three critical findings came purely from empirical testing:
1. **`Accept: audio/wav` returns headerless PCM, not a WAV file.** Found because the first generation run produced files that a browser plays as silence. The RIFF header is now added locally.
2. **Rime is not deterministic.** Four renders of one unchanged string return four different audio files. A measured noise floor now runs on every generate, per track.
3. **Coda reads `spell()` aloud as a word; Arcana honours it.** The first half confirms Rime's own documentation. The second half is not documented anywhere and was discovered purely through our own testing.

## Summary

This is a human-led, human-engineered submission. AI was a useful tool in the toolkit, much like a linter or a search engine, but the insights, measurements, and code logic are original.
