# Claude Cookbooks — recipe index

Generated from `registry.yaml` of [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) @ `6b671ef`.

Raw file URL pattern:

```
https://raw.githubusercontent.com/anthropics/claude-cookbooks/main/<path>
```

96 recipes across 13 primary categories.

## Agent Patterns

### Async multi-agent orchestration

- **Path:** `patterns/agents/async_multi_agent_orchestration.ipynb`
- **Categories:** Agent Patterns
- Two async multi-agent patterns — a fixed N-agent team with peer messaging through a shared hub, and dynamically spawned async subagents — reduced to their bare messaging and lifecycle mechanics.

### Basic workflows

- **Path:** `patterns/agents/basic_workflows.ipynb`
- **Categories:** Agent Patterns
- Three simple multi-LLM workflow patterns trading cost or latency for improved performance.

### Content policy enforcement with Claude

- **Path:** `capabilities/content_moderation/guide.ipynb`
- **Categories:** Agent Patterns, Tools, Multimodal
- Compile a written content policy into deterministic JSON rules, extract typed fields from text and images, and produce auditable verdicts from a rule engine that never calls a model.

### Cost Optimization on the Claude API

- **Path:** `cost_optimization/cost_optimization.ipynb`
- **Categories:** Agent Patterns, Evals
- An eval-driven guide to running agents on frontier models at production cost, applying the Claude API's cost levers one at a time.

### Evaluator optimizer

- **Path:** `patterns/agents/evaluator_optimizer.ipynb`
- **Categories:** Agent Patterns, Evals
- Workflow pattern using one LLM for generation and another for evaluation feedback loop.

### Orchestrator workers

- **Path:** `patterns/agents/orchestrator_workers.ipynb`
- **Categories:** Agent Patterns
- Central LLM dynamically delegates tasks to worker LLMs and synthesizes their combined results.

### Session memory compaction

- **Path:** `misc/session_memory_compaction.ipynb`
- **Categories:** Agent Patterns, Responses
- Manage long-running Claude conversations with instant session memory compaction using background threading and prompt caching.

### Using Haiku as a sub-agent

- **Path:** `multimodal/using_sub_agents.ipynb`
- **Categories:** Agent Patterns
- Analyze financial reports using Haiku sub-agents for extraction and Opus for synthesis.

## Claude Agent SDK

### Build a scheduled repository reviewer

- **Path:** `claude_agent_sdk/scheduled_repository_reviewer/scheduled_repository_reviewer.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Build a scheduled, read-only review agent that resumes its session and returns schema-validated verdicts linking each review to the last.

### Building a session browser

- **Path:** `claude_agent_sdk/05_Building_a_session_browser.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- List, read, rename, tag, and fork Agent SDK sessions on disk to build a conversation history sidebar without writing a transcript parser.

### Hosting your agent

- **Path:** `claude_agent_sdk/07_Hosting_the_agent.ipynb`
- **Categories:** Claude Agent SDK
- Deploy the research agent from notebook 00 through three tiers of operational maturity (Docker, Modal, Kubernetes) with the same container image and HTTP interface at every tier.

### Migrating from the OpenAI Agents SDK

- **Path:** `claude_agent_sdk/04_migrating_from_openai_agents_sdk.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Port an OpenAI Agents SDK app to the Claude Agent SDK, mapping each primitive (tools, guardrails, sessions, handoffs) through a single expense-approval agent example.

### Orchestrate subagents at scale with dynamic workflows

- **Path:** `claude_agent_sdk/08_Dynamic_workflows.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Trigger a dynamic workflow from the Agent SDK to fact-check a report against source documents with parallel verifier and skeptic subagents.

### The chief of staff agent

- **Path:** `claude_agent_sdk/01_The_chief_of_staff_agent.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Build multi-agent systems with subagents, hooks, output styles, and plan mode features.

### The observability agent

- **Path:** `claude_agent_sdk/02_The_observability_agent.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Connect agents to external systems via MCP servers for GitHub monitoring and CI workflows.

### The one-liner research agent

- **Path:** `claude_agent_sdk/00_The_one_liner_research_agent.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Build a research agent using Claude Code SDK with WebSearch for autonomous research.

### The site reliability agent

- **Path:** `claude_agent_sdk/03_The_site_reliability_agent.ipynb`
- **Categories:** Claude Agent SDK, Agent Patterns
- Build an incident response agent with read-write MCP tools for autonomous diagnosis, remediation, and post-mortem documentation.

### The vulnerability detection agent

- **Path:** `claude_agent_sdk/06_The_vulnerability_detection_agent.ipynb`
- **Categories:** Claude Agent SDK, Cybersecurity
- Build a vulnerability-discovery agent with the Claude Agent SDK that threat-models a C target, hunts memory-safety bugs with built-in file tools, and triages findings into a structured report.

## Claude Managed Agents

### Advisor: let a working agent consult a stronger model mid-turn

- **Path:** `managed_agents/CMA_consult_an_advisor.ipynb`
- **Categories:** Claude Managed Agents, Agent Patterns
- Add an advisor entry to a Managed Agents roster so a mid-tier working model can consult a more capable model inside a turn, read each consultation off the event stream, price it from the advisor thread's usage, and handle the redacted delivery arm.

### Budgets: cap what a session can spend

- **Path:** `managed_agents/CMA_cap_session_spend.ipynb`
- **Categories:** Claude Managed Agents, Observability
- Set an enforced list-cost budget on a Managed Agents session, watch spend accumulate through session.usage events, catch the budget_reached pause, and raise, lower, or remove the cap with sessions.update.

### Build a data analyst agent with Claude Managed Agents

- **Path:** `managed_agents/data_analyst_agent.ipynb`
- **Categories:** Claude Managed Agents, Tools
- Build an analyst that turns a CSV into a narrative HTML report with interactive charts, using a sandboxed environment and file mounting.

### Build a Slack data analyst bot with Claude Managed Agents

- **Path:** `managed_agents/slack_data_bot.ipynb`
- **Categories:** Claude Managed Agents, Integrations
- Mention the bot with a CSV to get an analysis report in-thread, with multi-turn follow-ups on the same session.

### Build agents that remember your users

- **Path:** `managed_agents/CMA_remember_user_preferences.ipynb`
- **Categories:** Claude Managed Agents, Tools
- Give your Claude Managed Agents a Memory store so they learn and remember your users' preferences across multiple interactions.

### Build an SRE incident response agent with Claude Managed Agents

- **Path:** `managed_agents/sre_incident_responder.ipynb`
- **Categories:** Claude Managed Agents, Observability
- Wire Claude into your on-call flow: when an alert fires, the agent reads logs and runbooks, pinpoints the root cause, opens a fix PR, and waits for your approval before merging.

### Coordinator pattern: big models for planning, small models for execution

- **Path:** `managed_agents/CMA_plan_big_execute_small.ipynb`
- **Categories:** Claude Managed Agents
- Two-model team economics via the multiagent coordinator config — a frontier coordinator plans and synthesizes while cheap search workers do the token-heavy web reading in parallel threads, compared against a rigor-matched solo-frontier control with real bills. Covers per-thread usage.list_cost metering, cost attribution, and a session budget as the fan-out guardrail.

### Data residency: pin an agent's inference geography

- **Path:** `managed_agents/CMA_pin_inference_geo.ipynb`
- **Categories:** Claude Managed Agents, Tools
- Pin a Managed Agents agent to US-region inference with model.inference_geo, confirm the pin on a session, work with the workspace allowed_inference_geos policy, and override the geography for a single session with agent_with_overrides.

### Fraud Review Agent with MongoDB Atlas and Claude Managed Agents

- **Path:** `managed_agents/CMA_with_mongodb_atlas.ipynb`
- **Categories:** Claude Managed Agents, RAG & Retrieval, Integrations, Tools
- Bring MongoDB Atlas to a Claude Managed Agent as its retrieval engine, graph store, and system of record — three credential-safe ways to connect, the four retrieval patterns (vector, full-text, reciprocal rank fusion, $graphLookup) as liftable building blocks, and a human-in-the-loop fraud-review agent that records decisions and an append-only audit trail in the same cluster.

### Managed Agents tutorial: iterate on a failing test suite

- **Path:** `managed_agents/CMA_iterate_fix_failing_tests.ipynb`
- **Categories:** Claude Managed Agents, Tools
- Entry-point tutorial for the Claude Managed Agents API. Walks through agent / environment / session creation, file mounts, and the streaming event loop by getting an agent to fix three planted bugs in a calc.py package.

### Managed Agents tutorial: production setup

- **Path:** `managed_agents/CMA_operate_in_production.ipynb`
- **Categories:** Claude Managed Agents, Integrations
- End-to-end production story for Managed Agents — vault-backed MCP credentials, the session.status_idled webhook pattern for human-in-the-loop without long-lived connections, the session.budget_reached webhook, inference_geo pinning for residency, and the resource lifecycle CRUD verbs.

### Managed Agents tutorial: prompt versioning and rollback

- **Path:** `managed_agents/CMA_prompt_versioning_and_rollback.ipynb`
- **Categories:** Claude Managed Agents, Evals
- Server-side prompt versioning — create v1, evaluate against a labelled test set, ship v2, detect a regression, roll back by pinning sessions to version 1. Covers agents.update, version pinning on sessions.create, and where the review gate moves when prompts are not code.

### Multiagent: coordinate a specialist team

- **Path:** `managed_agents/CMA_coordinate_specialist_team.ipynb`
- **Categories:** Claude Managed Agents, Tools
- Heterogeneous team via the multiagent coordinator config — a coordinator runs three specialists (web-search researcher, file-reading librarian, rules-based pricer) with scoped toolsets to assemble a sales proposal, plus an advisor entry the coordinator consults before writing. Covers the multiagent field, the thread_created / thread_message_received event types, and per-role tool scoping.

### Multiagent: watch a curriculum team work in real time

- **Path:** `managed_agents/CMA_watch_subagents_live.ipynb`
- **Categories:** Claude Managed Agents, Observability
- Stream a coordinator and its subagents live with per-thread event deltas, seed the session with initial_events, set model effort per agent, and update agents without the version round trip.

### Outcomes: agents that verify their own work

- **Path:** `managed_agents/CMA_verify_with_outcome_grader.ipynb`
- **Categories:** Claude Managed Agents, Evals
- Build a grade-and-revise loop with Outcomes: a writer drafts a cited research brief, a stateless grader fetches every URL and checks every quote against a rubric, and feedback drives revisions until the brief passes. Covers user.define_outcome, the span.outcome_evaluation_* events, and how to write a rubric the grader can act on.

### Skills: pick up a repo's .claude/skills automatically

- **Path:** `managed_agents/CMA_use_skills_from_a_repo.ipynb`
- **Categories:** Claude Managed Agents, Skills
- Mount a GitHub repository so its root .claude/skills directory is discovered at session start and injected into the agent, watch the read-then-follow protocol when a request matches a skill description, and learn the layout and lifecycle rules.

## Evals

### Building evals

- **Path:** `misc/building_evals.ipynb`
- **Categories:** Evals
- Build robust evaluation systems to measure and improve Claude's performance on key metrics.

### Generate synthetic test data for your prompt template

- **Path:** `misc/generate_test_cases.ipynb`
- **Categories:** Evals
- Generate synthetic test cases to evaluate and improve your Claude prompt templates effectively.

### Reproduce Claude's agentic search benchmark scores in the Messages API

- **Path:** `evals/agentic_search/reproduce_agentic_search_benchmarks.ipynb`
- **Categories:** Evals, Tools
- Build a Messages API harness that reproduces published DeepSearchQA and BrowseComp scores, using programmatic tool calling, server-side compaction, and task budgets.

### Tool evaluation

- **Path:** `tool_evaluation/tool_evaluation.ipynb`
- **Categories:** Evals
- Run parallel agent evaluations on tools independently from evaluation task files.

## Fine-Tuning

### Finetuning Claude 3 Haiku on Bedrock

- **Path:** `finetuning/finetuning_on_bedrock.ipynb`
- **Categories:** Fine-Tuning
- Step-by-step guide to finetuning Claude 3 Haiku on Amazon Bedrock for custom tasks.

## Integrations

### Claude 3 RAG agents with LangChain v1

- **Path:** `third_party/Pinecone/claude_3_rag_agent.ipynb`
- **Categories:** Integrations, RAG & Retrieval, Agent Patterns
- Build RAG agents with Claude 3 using LangChain v1's updated agent framework patterns.

### How to build a RAG system using Claude 3 and MongoDB

- **Path:** `third_party/MongoDB/rag_using_mongodb.ipynb`
- **Categories:** Integrations, RAG & Retrieval
- Build chatbot RAG system with Claude and MongoDB using tech news as knowledge base.

### Iteratively searching Wikipedia with Claude

- **Path:** `third_party/Wikipedia/wikipedia-search-cookbook.ipynb`
- **Categories:** Integrations
- Legacy notebook showing iterative Wikipedia searches with Claude 2 for research workflows.

### Low latency voice assistant with ElevenLabs

- **Path:** `third_party/ElevenLabs/low_latency_stt_claude_tts.ipynb`
- **Categories:** Integrations
- Build a low-latency voice assistant using ElevenLabs for speech-to-text and text-to-speech combined with Claude.

### Multi-document agents

- **Path:** `third_party/LlamaIndex/Multi_Document_Agents.ipynb`
- **Categories:** Integrations, RAG & Retrieval, Agent Patterns
- Build RAG for large document collections using DocumentAgents with ReAct Agent pattern.

### Multi-modal

- **Path:** `third_party/LlamaIndex/Multi_Modal.ipynb`
- **Categories:** Integrations, Multimodal
- Use LlamaIndex's Anthropic MultiModal LLM abstraction for image understanding and reasoning.

### RAG pipeline with LlamaIndex

- **Path:** `third_party/LlamaIndex/Basic_RAG_With_LlamaIndex.ipynb`
- **Categories:** Integrations, RAG & Retrieval
- Build basic RAG pipeline with LlamaIndex for document retrieval and question answering.

### ReAct agent

- **Path:** `third_party/LlamaIndex/ReAct_Agent.ipynb`
- **Categories:** Integrations, Agent Patterns, Tools
- Create ReAct agents with LlamaIndex for tool-based reasoning and action workflows.

### Retrieval-augmented generation using Pinecone

- **Path:** `third_party/Pinecone/rag_using_pinecone.ipynb`
- **Categories:** Integrations, RAG & Retrieval
- Connect Claude with Pinecone vector database for retrieval-augmented generation and semantic search.

### RouterQuery engine

- **Path:** `third_party/LlamaIndex/Router_Query_Engine.ipynb`
- **Categories:** Integrations, RAG & Retrieval
- Route queries to different indices using LlamaIndex RouterQueryEngine for multi-document search.

### SubQuestionQueryEngine

- **Path:** `third_party/LlamaIndex/SubQuestion_Query_Engine.ipynb`
- **Categories:** Integrations, RAG & Retrieval
- Decompose complex queries into sub-questions across multiple documents using LlamaIndex engine.

### Transcribe an audio file with Deepgram & use Anthropic to prepare interview questions!

- **Path:** `third_party/Deepgram/prerecorded_audio.ipynb`
- **Categories:** Integrations, Multimodal
- Transcribe audio with Deepgram and generate interview questions using Claude for preparation.

### Using the Wolfram Alpha LLM API as a tool with Claude

- **Path:** `third_party/WolframAlpha/using_llm_api.ipynb`
- **Categories:** Integrations, Tools
- Integrate Wolfram Alpha LLM API as Claude tool for computational queries and answers.

## Multimodal

### Best practices for using vision with Claude

- **Path:** `multimodal/best_practices_for_vision.ipynb`
- **Categories:** Multimodal
- Tips and techniques for optimal image processing performance with Claude's vision capabilities.

### Getting started - how to pass images into Claude

- **Path:** `multimodal/getting_started_with_vision.ipynb`
- **Categories:** Multimodal
- Tutorial on passing images to Claude 3 API for vision-based text analysis.

### Giving Claude a zoom tool for reading fine image detail

- **Path:** `multimodal/crop_tool.ipynb`
- **Categories:** Multimodal, Tools
- Give Claude a zoom tool that crops a region and magnifies it for detailed analysis of charts, documents, and diagrams.

### How to transcribe documents with Claude

- **Path:** `multimodal/how_to_transcribe_text.ipynb`
- **Categories:** Multimodal
- Extract and structure unstructured text from images and PDFs using Claude 3's vision.

### Using vision with tools

- **Path:** `tool_use/vision_with_tools.ipynb`
- **Categories:** Multimodal, Tools
- Combine Claude's vision with tools to extract structured data from images like nutrition labels.

### Working with charts, graphs, and slide decks

- **Path:** `multimodal/reading_charts_graphs_powerpoints.ipynb`
- **Categories:** Multimodal
- Extract insights from charts, graphs, and presentations using Claude's vision analysis capabilities.

## Observability

### Manage your organization with the Admin API

- **Path:** `misc/admin_api.ipynb`
- **Categories:** Observability
- Invite users, create workspaces, audit API keys, provision service accounts, and read rate limits with client.beta.organization in the Python SDK.

### Usage & cost Admin API cookbook

- **Path:** `observability/usage_cost_api.ipynb`
- **Categories:** Observability
- Programmatically access and analyze your Claude API usage and cost data via Admin API.

## RAG & Retrieval

### "Uploading" PDFs to Claude via the API

- **Path:** `misc/pdf_upload_summarization.ipynb`
- **Categories:** RAG & Retrieval
- Process and summarize PDF documents using Claude API with text extraction and encoding.

### Classification with Claude

- **Path:** `capabilities/classification/guide.ipynb`
- **Categories:** RAG & Retrieval
- Build classification systems with Claude using RAG and chain-of-thought for insurance tickets.

### Enhancing RAG with contextual retrieval

- **Path:** `capabilities/contextual-embeddings/guide.ipynb`
- **Categories:** RAG & Retrieval
- Improve RAG accuracy by adding context to chunks before embedding with prompt caching.

### How to make SQL queries with Claude

- **Path:** `misc/how_to_make_sql_queries.ipynb`
- **Categories:** RAG & Retrieval
- Generate SQL queries from natural language questions using Claude with database schema context.

### Knowledge graph construction with Claude

- **Path:** `capabilities/knowledge_graph/guide.ipynb`
- **Categories:** RAG & Retrieval, Tools
- Build knowledge graphs from unstructured text using Claude for entity extraction, relation mining, deduplication, and multi-hop graph querying.

### Retrieval augmented generation

- **Path:** `capabilities/retrieval_augmented_generation/guide.ipynb`
- **Categories:** RAG & Retrieval
- Build and optimize RAG systems with Claude using summary indexing and reranking techniques.

### Summarization with Claude

- **Path:** `capabilities/summarization/guide.ipynb`
- **Categories:** RAG & Retrieval, Responses
- Comprehensive guide to summarizing legal documents with evaluation and advanced techniques.

### Summarizing web page content with Claude 3 Haiku

- **Path:** `misc/read_web_pages_with_haiku.ipynb`
- **Categories:** RAG & Retrieval
- Fetch and summarize web page content using Claude 3 Haiku via URL extraction.

### Text to SQL with Claude

- **Path:** `capabilities/text_to_sql/guide.ipynb`
- **Categories:** RAG & Retrieval
- Convert natural language queries to SQL using RAG, chain-of-thought, and self-improvement techniques.

## Responses

### Batch processing with Message Batches API

- **Path:** `misc/batch_processing.ipynb`
- **Categories:** Responses
- Process large volumes of Claude requests asynchronously with 50% cost reduction using batches.

### Building a moderation filter with Claude

- **Path:** `misc/building_moderation_filter.ipynb`
- **Categories:** Responses
- Build customizable content moderation filters by defining rules and categories in prompts.

### Citations

- **Path:** `misc/using_citations.ipynb`
- **Categories:** Responses, RAG & Retrieval
- Enable Claude to provide detailed source citations when answering document-based questions for verification.

### Classifier fallback and billing for Claude Fable 5

- **Path:** `fable_5_fallback_billing/guide.ipynb`
- **Categories:** Responses
- Detect safety classifier blocks on Fable 5 and fall back to Opus 4.8 with server-side or SDK-based client-side fallback, including streaming behavior and the new billing changes.

### Extracting structured JSON using Claude and tool use

- **Path:** `tool_use/extracting_structured_json.ipynb`
- **Categories:** Responses, Tools
- Extract structured JSON data from various inputs using Claude's tool use capabilities.

### Metaprompt

- **Path:** `misc/metaprompt.ipynb`
- **Categories:** Responses
- Prompt engineering tool that generates starting prompts for your tasks to solve blank-page problem.

### Prompt caching through the Claude API

- **Path:** `misc/prompt_caching.ipynb`
- **Categories:** Responses
- Cache and reuse prompt context for cost savings and faster responses with detailed instructions.

### Prompting Claude for "JSON mode"

- **Path:** `misc/how_to_enable_json_mode.ipynb`
- **Categories:** Responses
- Get reliable JSON output from Claude using effective prompting techniques without constrained sampling.

### Prompting for frontend aesthetics

- **Path:** `coding/prompting_for_frontend_aesthetics.ipynb`
- **Categories:** Responses, Skills
- Guide to prompting Claude for distinctive, polished frontend designs avoiding generic aesthetics.

### Sampling responses from Claude beyond the max tokens limit

- **Path:** `misc/sampling_past_max_tokens.ipynb`
- **Categories:** Responses
- Generate longer responses beyond max_tokens limit using prefill technique with message continuation.

### Speculative prompt caching

- **Path:** `misc/speculative_prompt_caching.ipynb`
- **Categories:** Responses
- Reduce time-to-first-token by warming cache speculatively while users formulate their queries.

## Skills

### Building custom Skills for Claude

- **Path:** `skills/notebooks/03_skills_custom_development.ipynb`
- **Categories:** Skills
- Create, deploy, and manage custom skills extending Claude with specialized organizational workflows.

### Claude Skills for financial applications

- **Path:** `skills/notebooks/02_skills_financial_applications.ipynb`
- **Categories:** Skills
- Build financial dashboards and portfolio analytics using Claude's Excel, PowerPoint, PDF skills.

### Introduction to Claude Skills

- **Path:** `skills/notebooks/01_skills_introduction.ipynb`
- **Categories:** Skills
- Create documents, analyze data, automate workflows with Claude's Excel, PowerPoint, PDF skills.

## Thinking

### Extended thinking

- **Path:** `extended_thinking/extended_thinking.ipynb`
- **Categories:** Thinking
- Use Claude's extended thinking for transparent step-by-step reasoning with budget management.

### Extended thinking with tool use

- **Path:** `extended_thinking/extended_thinking_with_tool_use.ipynb`
- **Categories:** Thinking, Tools
- Combine extended thinking with tools for transparent reasoning during multi-step workflows.

## Tools

### Automatic context compaction

- **Path:** `tool_use/automatic-context-compaction.ipynb`
- **Categories:** Tools, Agent Patterns
- Manage context limits in long-running agentic workflows by automatically compressing conversation history.

### Context engineering: memory, compaction, and tool clearing

- **Path:** `tool_use/context_engineering/context_engineering_tools.ipynb`
- **Categories:** Tools, Agent Patterns
- Compare context engineering strategies for long-running agents and learn when each applies, what it costs, and how they compose.

### Creating a customer service agent with client-side tools

- **Path:** `tool_use/customer_service_agent.ipynb`
- **Categories:** Tools, Agent Patterns
- Build customer service chatbot with Claude using tools for customer lookup and order management.

### Memory & context management with Claude Sonnet 4.6

- **Path:** `tool_use/memory_cookbook.ipynb`
- **Categories:** Tools, Agent Patterns
- Build AI agents with persistent memory using Claude's memory tool and context editing.

### Note-saving tool with Pydantic and Anthropic tool use

- **Path:** `tool_use/tool_use_with_pydantic.ipynb`
- **Categories:** Tools
- Create validated tools using Pydantic models for type-safe Claude tool use interactions.

### Parallel tool calls on Claude 3.7 Sonnet

- **Path:** `tool_use/parallel_tools.ipynb`
- **Categories:** Tools
- Enable parallel tool calls on Claude 3.7 Sonnet using batch tool meta-pattern workaround.

### Programmatic tool calling (PTC)

- **Path:** `tool_use/programmatic_tool_calling_ptc.ipynb`
- **Categories:** Tools
- Reduce latency and token consumption by letting Claude write code that calls tools programmatically in the code execution environment.

### Threat intelligence enrichment agent

- **Path:** `tool_use/threat_intel_enrichment_agent.ipynb`
- **Categories:** Tools, Agent Patterns, Cybersecurity
- Build an agent that autonomously investigates IOCs by querying multiple threat intel sources, cross-referencing findings, mapping to MITRE ATT&CK, and producing structured reports for SIEM and SOAR integration.

### Tool choice

- **Path:** `tool_use/tool_choice.ipynb`
- **Categories:** Tools
- Control how Claude selects tools using tool_choice parameter for forced or auto selection.

### Tool search with embeddings

- **Path:** `tool_use/tool_search_with_embeddings.ipynb`
- **Categories:** Tools, RAG & Retrieval
- Scale Claude applications to thousands of tools using semantic embeddings for dynamic tool discovery.

### Using a calculator tool with Claude

- **Path:** `tool_use/calculator_tool.ipynb`
- **Categories:** Tools
- Provide Claude with calculator tool for arithmetic operations and mathematical problem solving.

