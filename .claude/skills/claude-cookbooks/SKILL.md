---
name: claude-cookbooks
description: Working reference for the official Claude Cookbooks (anthropics/claude-cookbooks) — 96 recipes covering agents, tool use, RAG, evals, multimodal, prompt caching, cost optimization, the Claude Agent SDK and Managed Agents. Use when building anything on the Claude API and you want a proven, copy-able pattern instead of writing it from scratch, when asked "how do I do X with Claude", or when the user mentions cookbook / recipe / notebook examples from Anthropic.
license: MIT (upstream: Copyright (c) 2023 Anthropic)
---

# Claude Cookbooks

The Claude Cookbooks are Anthropic's official collection of runnable Jupyter notebooks
showing how to build real things on the Claude API. This skill is an index over that
repository plus the conventions its code follows, so you can find the right recipe and
pull only the file you need.

Upstream: <https://github.com/anthropics/claude-cookbooks> (indexed at commit `6b671ef`, 2026-09-18).

## How to use this skill

1. **Find the recipe.** Grep `references/recipes.md` for the topic — it holds every
   registry entry's title, description, path and categories, grouped by category.
   If nothing matches, check `references/file-map.md`, which lists every notebook,
   doc and helper module in the repo including ones absent from the registry.
2. **Fetch only that file.** Do not clone 200 MB of notebook outputs to read one
   recipe. Use the raw URL:

   ```bash
   curl -sSL https://raw.githubusercontent.com/anthropics/claude-cookbooks/main/<path> -o /tmp/recipe.ipynb
   ```

   For a notebook, read the source cells rather than the stored outputs:

   ```bash
   python3 -c "import json,sys; nb=json.load(open('/tmp/recipe.ipynb')); \
   [print('#'*3, c['cell_type'], '\n', ''.join(c['source']), '\n') for c in nb['cells']]"
   ```

   If several recipes are needed at once, a shallow clone is fine:
   `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/anthropics/claude-cookbooks`.
3. **Adapt, don't transplant.** Cookbook notebooks are teaching code: they use
   `dotenv`, print intermediate state and skip error handling. Port the pattern into
   the host project's style, and apply the conventions below.

## Categories at a glance

| Category | What lives there |
|---|---|
| Agent Patterns | `patterns/agents/` — orchestrator-workers, evaluator-optimizer, prompt chaining, routing, parallelization |
| Claude Agent SDK | `claude_agent_sdk/` — research agent, chief-of-staff agent, SRE agent, vulnerability detection, observability, hosting |
| Claude Managed Agents | `managed_agents/` — server-hosted agents, sandboxes, MCP credentials, webhooks, Slack/Linear/Sentry integrations |
| Tools | `tool_use/` — tool definitions, parallel tools, memory, context engineering, customer-service agent, calculator, SQL |
| RAG & Retrieval | `capabilities/retrieval_augmented_generation/`, `capabilities/contextual-embeddings/`, `third_party/` (Pinecone, Voyage, MongoDB, LlamaIndex, Wikipedia) |
| Multimodal | `multimodal/` — vision basics and best practices, charts/graphs, form transcription, sub-agents, PDF handling |
| Evals | `evals/`, `tool_evaluation/` — building evals, agentic search benchmarks, LLM-as-judge |
| Skills | `skills/` — Agent Skills introduction, financial applications, building custom skills |
| Thinking | `extended_thinking/` — extended thinking and thinking-with-tool-use |
| Observability | `observability/` — tracing and monitoring Claude apps |
| Integrations | `third_party/` — Deepgram, ElevenLabs, WolframAlpha and friends |
| Fine-Tuning | `finetuning/` — dataset prep and fine-tuning flows |
| Responses | shaping what comes back — JSON mode, citations, batch processing, prompt caching (incl. speculative), session memory compaction, sampling past max_tokens, metaprompt |

Frequently wanted one-offs: prompt caching (`misc/prompt_caching.ipynb`),
cost optimization (`cost_optimization/cost_optimization.ipynb`),
JSON mode (`misc/how_to_enable_json_mode.ipynb`),
batch processing and moderation filters (`misc/`).

## Conventions the cookbook code follows

**Model IDs — always the non-dated alias.** Never write `claude-sonnet-4-6-20250514`.

| Model | API id |
|---|---|
| Opus 5 | `claude-opus-5` |
| Sonnet 5 | `claude-sonnet-5` |
| Haiku 4.5 | `claude-haiku-4-5-20251001` |

On Bedrock the ids take the form `anthropic.claude-<model>`, with `global.` prepended
for global endpoints (recommended); some models carry a dated `-YYYYMMDD-v1:0` suffix
and newer ones don't. Look the exact Bedrock id up in the docs rather than guessing it.
Model tables age — confirm against docs.claude.com before pinning anything.

**Secrets.** `dotenv.load_dotenv()`, then `os.environ["ANTHROPIC_API_KEY"]`. Never
inline a key, never commit `.env`.

**Python tooling.** `uv` for dependencies (`uv add <pkg>`, never hand-edit
`pyproject.toml`), `ruff` for format and lint, 100-char lines, double quotes.
Notebooks relax E402 / F811 / N803 / N806.

**Notebook hygiene.** One concept per notebook; outputs are kept on purpose (they are
the demonstration); a notebook must run top-to-bottom without errors. New recipes get
an entry in `registry.yaml` and an author in `authors.yaml`.

When contributing upstream: branch `<username>/<feature-description>`, conventional
commits (`feat(scope): …`), `make check` before pushing.

## Reference files

- `references/recipes.md` — all 96 registry recipes with descriptions, by category.
- `references/file-map.md` — every notebook, doc and module in the repo, by directory.
