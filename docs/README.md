# Nana — engineering docs

This is the knowledge base for contributors and agents. Start with [`../AGENTS.md`](../AGENTS.md) for the rules and command cheat sheet, then open [`architecture.md`](architecture.md) to orient yourself.

The docs describe **how the code works today**. When code and docs disagree, the code wins and the doc must be fixed in the same change.

## Map

| Doc | Covers | Read when… |
| --- | --- | --- |
| [`architecture.md`](architecture.md) | System topology, request lifecycle, data flows, source map | Starting any work |
| [`api.md`](api.md) | Bun API routes, PocketBase routes, payloads, auth | Changing an endpoint or integration |
| [`frontend.md`](frontend.md) | React, routing, auth, Jotai, editor, settings, UI quality | Changing UI or client state |
| [`pocketbase.md`](pocketbase.md) | JSVM hooks, migrations, collections, settings, trash, sharing | Changing schema or backend behavior |
| [`ai-and-embeddings.md`](ai-and-embeddings.md) | Chat, providers, RAG, chunking, vector store, auto-embed | Touching AI features |
| [`security.md`](security.md) | Trust boundaries, auth, proxy, CSP, rate limits, secrets | Changing access or exposure |
| [`testing.md`](testing.md) | Docker test stack, layout, helpers, conventions | Adding or fixing tests |
| [`deployment.md`](deployment.md) | Build, Docker, compose, releases, operations | Building, shipping, debugging deploys |
| [`development.md`](development.md) | Local setup, workflow, common tasks, sharp edges | Beginning implementation |
| [`../PRODUCT.md`](../PRODUCT.md) | Audience, product truth, principles, surfaces | Deciding what belongs in the product |
| [`../DESIGN.md`](../DESIGN.md) | Ember & Ink tokens, type, components, motion, voice | Building or reviewing UI |

## Documentation rules

1. **One subsystem per doc.** Link to another doc instead of duplicating its detail.
2. **Update docs with behavior.** A route, schema, config, command, or architecture change updates the affected doc in the same change.
3. **Keep the map current.** New docs must be linked from this file and `AGENTS.md`.
4. **Docs may name files, functions, env vars, and internals.** This is engineering documentation, not the user manual.
5. **The user-facing front door is [`../README.md`](../README.md).** Keep install and feature content there, not here.
6. **No secrets or real credentials** in examples.
