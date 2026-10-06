# Engine snapshots

Full copies of `src/common/js/ai.js` at each revision worth keeping.
Restore any of them with `cp engine-history/<file> src/common/js/ai.js`.

| file | md5 | bytes | date | note |
|---|---|---|---|---|
| engine-history/ai-1.2.1-lean.js | acc49d4f5a2abeaac7c31b14ca443ff8 | 80753 | 2026-10-06 | current WIP: Chebyshev endgame fix + pawn cohesion/threats/passed-escort + bad bishop + cheap king-danger. Reverted the 3x-cost mobility ray walk. |
| engine-history/ai-1.2.0-shipped.js | 69785e233771fd004b0a5585cc250a14 | 72737 | 2026-10-06 | the engine shipped in the released 1.2.0 RPKs; baseline for every measurement |
| engine-history/ai-1.2.1-lean-lmp.js | 642d4b2c6fa209c9088bfe0db73aed1b | 81401 | 2026-10-06 | lean eval + late move pruning (new) |
| engine-history/ai-1.2.1-book.js | 14281cc9e235d590b4aec00ab58faa8b | 83033 | 2026-10-06 | lean eval + Stockfish-derived opening book (54 -> 204 positions, 10 plies deep) |
