# Nightly Run55 packaging and harness review, 2026-10-03

The scoped packager change removes host paths from two canonical generated resources in installed copies while preserving the frozen raw inputs and recording separate raw/installed hashes. The `about:buildconfig` compiler display and exact configure tokens use `[build-root]`; the canonical generated RFP source comment on line 2 uses relative paths. Unexpected resources, roots, executable markup, prefixed or longer tokens, and non-comment RFP paths are rejected.

The baseline harness now pins compiled `dist` runtime assets, including the worker, and direct same-origin HTML dependencies, including the loaded xterm JS/CSS. These fill omissions in the previous pin set; the retained preparation records 52 runtime asset pins. The legacy task keeps its default 2 GiB allowance. Only the exact authorized `/mnt/p6/project/build/nightly-baseline-guest-20261003` root receives 4 GiB through `--task-root`; output/scratch containment, the 20 GiB reserve, CPU selection, ownership, deadlines and cleanup guards remain in scope. The NSS fixture realpath is checked against the selected task.

The independent review passed 30 sanitation checks and 29 harness checks and rehashed the four source files plus eight evidence inputs. Retained owner checks passed 52 package regressions, 49 baseline regressions and 28 NSS host-preparation checks. The package regressions use tiny synthetic fixtures; runtime preflight and generated-resource hashes refer to the actual Run55 raw inputs. CPU/lifecycle preservation was reviewed through the diff and finite source contracts, without a real guest cleanup or CPU gate.

Full package creation, actual startup, NSS/TLS, broad JIT, Firefox GPU and deployment acceptance remain separate pending work. This commit changes packaging/harness code and review documentation; it establishes no guest or release acceptance.

Evidence: [independent review packet](evidence/nightly-run55-packaging-harness-review-20261003.json), copied byte-for-byte from the reviewed report (SHA256 `8ae47a073c8d31956f898374b07d6619a9fdadebea39b0f6b701d62af6da8f06`).
