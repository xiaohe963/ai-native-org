# AI-Native Organization Design

> When agents do the work, organizations must redesign proof—not process.

**English** | [中文](README.zh-CN.md)

This project studies how decision rights, information flow, authorization, acceptance,
and retrospectives should be redesigned once agents take on much of the execution.

It does not provide org-chart templates or prompt tricks. It provides a set of
**judgeable conventions**: what counts as done, who may decide, what evidence is
required, and under what conditions a claim should be overturned.

## Stance

1. Hidden organizational constraints—risk appetite, what "good" means, who may say yes—are the equivalent of non-functional requirements in software. They must be made explicit.
2. A design claim without a falsification condition is not knowledge—it is phrasing.
3. Decision rights and execution capability are two independent contracts. Conflating them is the root cause of most "AI organization" proposals.
4. Outputs must be testable in a real organization, not merely coherent in terminology.

## Repository layout

| Path | Contents |
| --- | --- |
| `docs/` | Five documents: domain model, decision rights, evidence, context flow, feedback (currently in Chinese) |
| `decisions/` | 15 ADRs; 1 currently accepted |
| `templates/change-card.md` | Change card v1.1 with eight gates |
| `playbooks/` | How to design a complete proposal |
| `evals/` | Comparative evaluation method |
| `cases/` | Real cases (only a template so far) |
| `site/index.html` | Project site, ready for GitHub Pages |
| `workbench/` | Change-card workbench (Node backend + single-page frontend) |

## Quick start: change-card workbench

Requires Node 18+.

```bash
cd workbench
cp config.example.json config.json
node server.js
```

Open `http://127.0.0.1:8787`. On Windows you can also double-click
`workbench/start.bat` (copy the config first).

The workbench:

- stores structured card state in `workbench/data/cards/*.json` (gitignored)
- reads `git status / log / diff` from the configured repository
- writes one card to `runs/<date>-<slug>.md` and commits **only that file**
- enforces gates server-side: it refuses to mark a card "authorized / accepted / declared reachable" when the gates fail

## Current state (honest counts)

- 15 ADRs, 1 accepted (ADR-015: git as a repository-level evidence capability)
- 5 change cards live in the private evidence archive; this repository does not include `runs/`
- 0 real organizational cases; no L3; no independent second-party judgment
- The methodology is still self-referential: it validates its own conventions, not outcomes in an external organization

## Language status

- The project site is available in [English](site/index.html) and [中文](site/zh.html).
- The methodology documents, ADRs, and the workbench UI are currently in Chinese.
- English translations are welcome; when translating an ADR, treat the Chinese original as authoritative and add the translation as a separate file rather than rewriting history.

## License

- Code (`workbench/`): MIT, see `LICENSE`
- Documentation and methodology (`docs/`, `decisions/`, `templates/`, `playbooks/`, `site/`): CC BY 4.0, see `LICENSE-docs`

## Not claimed

This repository does not claim that git proves committer identity, independent review,
test results, or production state; that a change card improves change success rates;
or that any claim below L2 has been established.
