# Validation checkpoint — 2026-10-04

- F010, Windows x64, Node v24.19.0; C++17 compiled with Zig 0.15.2, `-O3 -DNDEBUG`.
- `node --test tests/*.test.js`: 35 tests including nested API tests; all passed. The model batch covers 40 seeds × 5 scenarios. Native equivalence covers 200 scenario snapshots plus 80 chunked boundary configurations, including full logs.
- `node tests/app-ui.cjs`: passed with installed Playwright + separate headless Microsoft Edge. Registration, login, logout, repeat calculation/reset, five templates, saved scenario/run, profile/reload, RU/KK/EN across five pages, 390px, keyboard and zero JS errors.
- API tests also verify six concurrent native worker requests without scenario mixing, CSRF, second-account isolation, SQLite persistence across restart, password change and session revocation.
- Browser screenshots inspected: `artifacts/app-en-desktop.png`, `artifacts/app-en-mobile.png`; RU/KK screenshots also generated. They are local QA artifacts, excluded from Git.
- Live endpoint: `http://127.0.0.1:3000/api/health` returns `status=ok`, `engine=cpp17`, `database=sqlite`, `synthetic=true`.
- Secret-pattern scan of staged sources: no matches for common GitHub/OpenAI/AWS/private-key patterns. This is a bounded automated scan, not a claim of universal secret detection. No user database, sessions, `.env`, tools, build outputs or QA databases are tracked.

## Performance measurement

Final `docs/benchmark.json`: 5 samples × 500 complete baseline runs after 500 JS warmup runs. No UI test or compilation ran concurrently with the final sample.

Median JS: **174.7532 ms**; native model/snapshot construction: **144.7325 ms**; native including one batch-process startup and output: **155.9008 ms**.

Compute ratio **1.2074×**, batch wall ratio **1.1209×**. This modest local benchmark is not a claim that the whole application is 20.7% faster or that any real factory process improves. The server uses two persistent native workers to avoid launching a process per interactive request. End-to-end browser latency was not benchmarked against the old application.

## Explicit limits

No runtime checkpoint restore/branching, Monte Carlo, probabilistic lateness intervals, ML, real factory data, production security certification or usability study with older adults. Scenario edits and API time steps replay independently from t=0. Historical runs preserve their own configuration; they are not live engine snapshots. Kazakh text needs native editorial review before a real pilot.

Windows Computer Use/node_repl is not available in this session. UI QA used controlled Playwright browser sessions; it did not inspect or automate the user's authenticated browser. GitHub repository creation was coordinated separately; source publication uses standard Git Credential Manager.
