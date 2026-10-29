# Lore answer quality implementation plan

Goal: explain Genshin knowledge naturally with verifiable sources, without turning ordinary questions into corpus audits.

Reference: local genshin-lore-rag README, DESIGN, lore/store.py and genshin-lore SKILL.md. Its CLI retrieves evidence; the assistant synthesizes. Current browser failure: the Sumeru Archon Quest overview uses UI/reunion reward text and overstates corpus absence.

Implementation:
- [x] Add regression tests for alias expansion, scoped narrative retrieval, automatic context reads, narrower tool filters, and explicit evidence-budget truncation.
- [x] Add a focused answer policy module: answer first, explain concepts/causes, adapt depth, cite meaningful passages, qualify only the affected claim. Preserve all provenance, unknown-context, language and snapshot protections.
- [x] Expand reviewed aliases only for retrieval; scope the first narrative search away from UI text; read at most two mapped sources before generation. Tool searches may narrow explicit filters but never widen them. Report omitted matches separately from zero matches.
- [x] Run all web tests/typecheck, local real-corpus probes, then one browser answer using the existing configured connection if available. Record what is mocked, retrieved and actually generated.

Alternatives: prompt-only is smaller but leaves irrelevant evidence and false empty searches; a corpus rebuild/semantic model migration is costly and unnecessary for these demonstrated defects. Use the bounded retrieval + prompt change. No downloads, source changes, new model, or paid keys are needed for implementation/tests.

Follow-up from actual model output: exact phrase discovery uses /v1/documents, task/causal scope guidance, full-width citation support, bounded prefetch, preserved read truncation, and separation of tool narration from the final answer.

The actual overview acceptance required a readonly Chapter-to-MainQuest outline query, bounded/fair cross-act sampling, localized whole-arc intent routing, and per-field chapter citation spans. These were implemented and covered by Python/agent tests without reimport or data changes.
