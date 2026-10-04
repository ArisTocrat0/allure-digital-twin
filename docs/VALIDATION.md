# Validation checkpoint — 2026-10-04

- F010, Windows x64, Node v24.19.0; C++17 compiled with Zig 0.15.2, `-O3 -DNDEBUG`.
- `node --test tests/*.test.js`: 43 tests including nested API tests; all passed. The model batch covers 40 seeds × 5 scenarios. Native equivalence covers 200 scenario snapshots plus 80 chunked boundary configurations, including full logs.
- `node tests/app-ui.cjs`: passed with installed Playwright + separate headless Microsoft Edge. Registration, login, logout, repeat calculation/reset, five templates, saved scenario/run, profile/reload, RU/KK/EN across five pages, 390px, keyboard and zero JS errors. Zero- and two-delivery scenarios load and save without fabricating or losing deliveries.
- API tests also verify six concurrent native worker requests without scenario mixing, CSRF, second-account isolation, SQLite persistence across restart, password change and session revocation.
- Browser screenshots inspected: `artifacts/app-en-desktop.png`, `artifacts/app-en-mobile.png`; RU/KK screenshots also generated. They are local QA artifacts, excluded from Git.
- Live endpoint: `http://127.0.0.1:3000/api/health` returns `status=ok`, `engine=cpp17`, `database=sqlite`, `synthetic=true`.
- Secret-pattern scan of staged sources: no matches for common GitHub/OpenAI/AWS/private-key patterns. This is a bounded automated scan, not a claim of universal secret detection. No user database, sessions, `.env`, tools, build outputs or QA databases are tracked.

## Performance measurement

Final `docs/benchmark.json`: 5 samples × 500 complete baseline runs after 500 JS warmup runs. No UI test or compilation ran concurrently with the final sample.

Median JS: **195.1980 ms**; native model/snapshot construction: **159.4225 ms**; native including one batch-process startup and final output: **169.0880 ms**.

Compute ratio **1.2244×**, batch wall ratio **1.1544×**. Each batch runs 500 independent models and constructs full snapshots/logs each time, but **only its final native snapshot is serialized and returned**. These are not HTTP, database or UI timings. The server uses two persistent native workers. End-to-end browser latency was not benchmarked against the old application.

## P2 audit fixes and regressions

1. `shipEvery=4294967596` now returns API 400 and a native validation error. All consumed integer fields are bounded before narrowing, including CLI until/repeat/targets; there are explicit tests across 30 field paths plus request parameters.
2. Native stdout uses `setEncoding("utf8")`. A deterministic mock splits every byte of Cyrillic/Kazakh/emoji JSON; six real large-output runs also match the complete JS snapshot and Russian log.
3. HTTP JSON buffers are assembled before strict UTF-8 decoding, with a byte limit. The real TCP test splits Ж between its first and second bytes with a 40ms delay; Жанар is preserved. Malformed UTF-8 returns 400.
4. UI loads and saves both zero and multiple deliveries. Tests verify empty arrays remain empty and each delivery's parts are preserved when one timestamp changes.

Release C++ was rebuilt with the documented O3 command. An additional `build/twin-ubsan.exe` was compiled with Zig C++17, `-O1 -g -fsanitize=undefined -fsanitize-trap=undefined`. All 5 native/boundary test groups passed against that executable, including the 280 complete-state equivalence cases. **ASan and a prolonged load test were not performed.**

The local server was restarted after the fixes, PID 4832, and health returned 200 with cpp17/sqlite. No user rows or database files were reset or replaced; tests used isolated artifact databases.

## Explicit limits

No runtime checkpoint restore/branching, Monte Carlo, probabilistic lateness intervals, ML, real factory data, production security certification or usability study with older adults. Scenario edits and API time steps replay independently from t=0. Historical runs preserve their own configuration; they are not live engine snapshots. Kazakh text needs native editorial review before a real pilot.

Windows Computer Use/node_repl is not available in this session. UI QA used controlled Playwright browser sessions; it did not inspect or automate the user's authenticated browser. GitHub repository creation was coordinated separately; source publication uses standard Git Credential Manager.

## P3 Unicode configuration boundary

The complete release suite passed 43 tests after the Unicode fix. Lone high and low UTF-16 surrogates in order IDs return HTTP 400 `invalid_config` for create/update/direct simulate. Rejected writes leave the saved scenario list unchanged. A valid paired emoji is created with HTTP 201 and then simulated by saved scenario ID with HTTP 200; the complete native result matches the JS reference. Unit coverage also includes malformed nested metadata/keys, valid Cyrillic/Kazakh text and a valid supplementary scalar pair.

The check runs before persistence/native serialization. No C++ or UI code changed for P3, so the earlier native rebuild/UBSan and UI results above remain the P2 checkpoint evidence, not newly repeated P3 checks. The user database is preserved; existing invalid rows, if any, are not rewritten or deleted.
