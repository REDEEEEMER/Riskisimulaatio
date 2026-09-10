# Agent instructions

- Use the Go version declared in go.mod.
- Workflow: understand task -> search with rg/Git -> select minimal files -> read target code -> direct dependency signatures if needed -> modify -> gofmt -> verify -> inspect failures -> git diff -> fix if needed -> final verification.
- Never start ordinary tasks by reading the entire repository; broaden context only when demonstrably needed.
- Read only task-relevant files; do not reread unchanged files without a concrete reason.
- Do not read generated code, dependencies, logs, build artifacts, or unrelated tests by default.
- Read tests only when changing covered behavior, editing relevant tests, or diagnosing failures.
- Inspect compiler/test output before speculative debugging; review git diff before rereading changes.
- Prefer existing cohesive domain files and explicit data flow over new files or layers.
- Prefer existing abstractions; add no speculative abstractions, DI frameworks, or unnecessary interfaces.
- Prefer the standard library; justify every external dependency and seek approval for significant additions.
- Preserve strong types and readable, meaningful names; do not minify code to save tokens.
- Comment only non-obvious constraints, invariants, or reasons; avoid redundant object representations.
- Add tests for meaningful behavior and invariants, not trivial plumbing or standard-library behavior.
- After changes run `gofmt -w .`, `go test ./...`, and `go vet ./...`; rerun after fixes.
- Keep changes scoped; prefer local changes over architectural refactors.
- Never expose or commit secrets.
- Ask the operator only for required product/architecture judgment or unavailable information; routine local reversible implementation needs no approval.
- Optimize total AI input, output, and retry tokens per correct verified change, not source size.
