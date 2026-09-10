# Riskisimulaatio

Minimal Go repository, optimized for low context cost per correct verified change.
Uses only the standard library. `main.go` is the buildable entry point; add domain
behavior and configuration files only when a feature needs them.

Use the Go version in `go.mod`. Run with `go run .` (currently exits without output).
Verify changes with:

```sh
gofmt -w .
go test ./...
go vet ./...
```

## Operator duties

The operator defines feature intent and acceptance criteria, resolves ambiguous
business/product requirements, approves major architecture changes and significant
new dependencies, manages credentials and secrets, decides whether destructive
actions or migrations are acceptable, reviews security-sensitive changes and large
or cross-cutting diffs, decides when broad architectural context is justified, and
maintains `AGENTS.md` as a small set of durable rules.

Coding agents handle repository search, implementation, routine refactoring,
formatting, compilation, static analysis, tests, failure investigation, their own
diff review, and scope control. Routine reversible local decisions covered by
repository conventions do not require human approval.
