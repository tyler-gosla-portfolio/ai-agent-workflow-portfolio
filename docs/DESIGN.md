# AI Agent Workflow System - Design Document

## Document Control
- Project: AI Agent Workflow System
- Repository: `ai-agent-workflow-portfolio`
- Version: 1.0
- Date: 2026-02-16
- Timebox: Design phase scoped for 2 hours

## 1. System Architecture

### 1.1 High-Level Architecture

```text
+---------------------------+        +---------------------------+
|        CLI / SDK          |        |      External Systems     |
|  - `agentwf run`          |<------>|  - LLM APIs               |
|  - Python API             |        |  - MCP Servers            |
+-------------+-------------+        |  - Web/File/Exec Targets  |
              |                      +-------------+-------------+
              v                                    ^
+-------------+---------------------------------------------------+
|                    Agent Runtime Layer                          |
|  +------------------+   +-------------------+   +-------------+ |
|  | Agent Core       |-->| Tool Registry     |-->| Tool Runner | |
|  | - planning loop  |   | - @tool metadata  |   | - validation| |
|  | - model adapter  |   | - schema index    |   | - execution | |
|  +--------+---------+   +---------+---------+   +------+------+
|           |                         |                   |
|           v                         v                   v
|  +--------+---------+   +-----------+---------+   +-----+-----+
|  | Workflow Engine  |<->| Event Bus / Hooks   |<->| Observability|
|  | - DAG scheduler  |   | - callbacks         |   | - traces/logs|
|  | - retries        |   | - lifecycle events  |   | - metrics    |
|  +--------+---------+   +-----------+---------+   +-----------+
|           |                         |
|           v                         v
|  +--------+---------+   +-----------+---------+
|  | State Manager    |   | MCP Client Adapter  |
|  | - memory + store |   | - discover/call     |
|  | - checkpoints    |   | - resource access   |
|  +------------------+   +---------------------+
+---------------------------------------------------------------+
```

### 1.2 Core Design Principles
- Async-first: all I/O boundaries use `async` interfaces.
- Type-safe contracts: `pydantic` models define all tool inputs, outputs, and events.
- Deterministic orchestration: workflow DAG execution is dependency-driven and replayable.
- Provider abstraction: LLM and MCP integration are pluggable adapters.
- Fault tolerance: retries, compensation hooks, and persisted checkpoints.

### 1.3 Component Interactions
1. Caller invokes `Agent.run(task, context)`.
2. Agent asks model adapter for a plan or next action.
3. If a tool call is selected, `ToolRegistry` validates request and runs the tool.
4. State is updated after each step and emitted to event hooks.
5. For structured workflows, `WorkflowEngine` schedules ready DAG nodes.
6. MCP-backed tools are discovered/called via `MCPClient`.
7. Final result is synthesized and returned with execution metadata.

### 1.4 Data Flow
- Input: `RunRequest(task, constraints, initial_state)`
- Internal:
  - `AgentState` snapshots per step
  - `ToolInvocation` and `ToolResult` records
  - `WorkflowExecutionState` with node statuses
- Output: `RunResult(final_answer, artifacts, trace_id, usage)`

## 2. Tech Stack

### 2.1 Runtime and Language
- Python 3.11+
- `asyncio` with `TaskGroup` patterns for parallel node execution
- Optional `uvloop` in production for improved event-loop performance

### 2.2 Validation and Data Models
- `pydantic` v2 for:
  - request/response models
  - tool parameter schemas
  - persisted state snapshots
  - event payload validation

### 2.3 LLM and Protocol Integration
- LLM providers via adapter pattern (`OpenAIAdapter`, `AnthropicAdapter`, `LocalAdapter`)
- MCP integration via `MCPClient` over stdio or HTTP transport

### 2.4 Suggested Dependencies
- Core: `pydantic`, `httpx`, `typing-extensions`
- Async/Test: `pytest`, `pytest-asyncio`, `anyio`
- Optional: `orjson`, `tenacity`, `rich`

## 3. Core Components

### 3.1 Agent Class (Base Agent with Tool Support)

```python
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Any

class RunRequest(BaseModel):
    task: str
    max_steps: int = 20
    context: dict[str, Any] = Field(default_factory=dict)

class RunResult(BaseModel):
    final_answer: str
    steps_taken: int
    artifacts: dict[str, Any] = Field(default_factory=dict)

class Agent:
    def __init__(self, name: str, model_client, tools, state_manager, event_bus):
        self.name = name
        self.model_client = model_client
        self.tools = tools
        self.state = state_manager
        self.events = event_bus

    async def run(self, request: RunRequest) -> RunResult:
        await self.events.emit("run.started", {"agent": self.name, "task": request.task})
        step = 0
        while step < request.max_steps:
            decision = await self.model_client.next_action(request.task, self.state.current())
            if decision.type == "final":
                result = RunResult(final_answer=decision.answer, steps_taken=step)
                await self.state.save_final(result)
                await self.events.emit("run.completed", result.model_dump())
                return result
            tool_result = await self.tools.invoke(decision.tool_name, decision.arguments)
            await self.state.append_step(tool_result)
            step += 1
        raise RuntimeError("Max steps reached")
```

Key responsibilities:
- Control agent decision loop
- Orchestrate tool calls
- Persist/checkpoint state
- Emit lifecycle events

### 3.2 Tool Registry (Decorator-Based Registration)

```python
from pydantic import BaseModel, ValidationError
from inspect import signature, iscoroutinefunction

class ToolSpec(BaseModel):
    name: str
    description: str
    input_model: type[BaseModel]
    fn: callable

class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"Duplicate tool: {spec.name}")
        self._tools[spec.name] = spec

    async def invoke(self, name: str, args: dict):
        spec = self._tools[name]
        validated = spec.input_model.model_validate(args)
        data = validated.model_dump()
        if iscoroutinefunction(spec.fn):
            return await spec.fn(**data)
        return spec.fn(**data)

def tool(name: str, description: str, input_model: type[BaseModel]):
    def wrapper(fn):
        fn.__tool_meta__ = ToolSpec(name=name, description=description, input_model=input_model, fn=fn)
        return fn
    return wrapper
```

Registration pattern:
- Decorate function with `@tool(...)`
- Collect `__tool_meta__` during module scan or explicit bootstrap
- Publish schema to model-facing tool manifest

### 3.3 Workflow Engine (DAG-Based Execution)

```python
from enum import Enum
from pydantic import BaseModel, Field

class NodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"

class WorkflowNode(BaseModel):
    id: str
    tool: str
    args_template: dict = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    retry_limit: int = 2

class WorkflowDefinition(BaseModel):
    id: str
    nodes: list[WorkflowNode]

class WorkflowEngine:
    async def execute(self, wf: WorkflowDefinition, context: dict, registry: ToolRegistry):
        # Topological scheduling + parallel dispatch for ready nodes.
        # Persist each transition for replay/recovery.
        ...
```

Execution behavior:
- Validate acyclic graph at load time.
- Mark nodes READY when all dependencies are `SUCCESS`.
- Use `asyncio.TaskGroup` for concurrent independent nodes.
- Retry failed nodes with exponential backoff.
- Support stop policy (`fail_fast`, `best_effort`).

### 3.4 State Manager (Persistence Layer)

State layers:
- Volatile session memory (in-process)
- Durable checkpoint store (SQLite/Postgres)
- Artifact storage (filesystem/object store)

```python
class StateManager:
    async def create_run(self, run_id: str, payload: dict): ...
    async def append_event(self, run_id: str, event: dict): ...
    async def save_checkpoint(self, run_id: str, step: int, snapshot: dict): ...
    async def load_latest_checkpoint(self, run_id: str) -> dict | None: ...
    async def save_final(self, run_id: str, result: dict): ...
```

Persistence recommendation:
- Dev: SQLite + JSON blob columns
- Prod: Postgres with indexed fields (`run_id`, `created_at`, `status`)

### 3.5 MCP Client (Protocol Integration)

Capabilities:
- Connect to one or more MCP servers
- Discover tools/resources/prompts
- Call remote tools using protocol envelopes
- Normalize MCP responses into internal `ToolResult`

```python
class MCPClient:
    async def connect(self, server_name: str, transport: str, target: str): ...
    async def list_tools(self, server_name: str) -> list[dict]: ...
    async def call_tool(self, server_name: str, tool_name: str, arguments: dict) -> dict: ...
    async def read_resource(self, server_name: str, uri: str) -> dict: ...
```

Integration path:
- Mirror MCP tools into local `ToolRegistry` namespace (`mcp.<server>.<tool>`)
- Cache capability metadata with TTL
- Enforce allowlist for sensitive MCP servers

## 4. API Design

### 4.1 `Agent.run()` Interface

```python
async def run(
    self,
    task: str,
    *,
    context: dict | None = None,
    workflow: "WorkflowDefinition | None" = None,
    max_steps: int = 20,
    callbacks: list["EventCallback"] | None = None,
) -> RunResult:
    ...
```

Behavior:
- `workflow=None`: autonomous tool-using loop
- `workflow` provided: execute DAG with optional model decisions between nodes

### 4.2 Tool Decorator Pattern

```python
class SearchInput(BaseModel):
    query: str
    top_k: int = 5

@tool(name="web_search", description="Search trusted web sources", input_model=SearchInput)
async def web_search(query: str, top_k: int = 5) -> list[dict]:
    ...
```

Contract:
- Input validation is mandatory via `pydantic`
- Tool execution result must be JSON-serializable
- Runtime captures duration, errors, and output size

### 4.3 Workflow Definition DSL

Python DSL example:

```python
workflow = WorkflowDefinition(
    id="research_report",
    nodes=[
        WorkflowNode(id="discover", tool="web_search", args_template={"query": "{task}"}),
        WorkflowNode(id="summarize", tool="synthesize_notes", depends_on=["discover"]),
        WorkflowNode(id="write", tool="write_file", depends_on=["summarize"]),
    ],
)
```

YAML option (for CLI users):

```yaml
id: research_report
nodes:
  - id: discover
    tool: web_search
    args_template:
      query: "{task}"
  - id: summarize
    tool: synthesize_notes
    depends_on: [discover]
  - id: write
    tool: write_file
    depends_on: [summarize]
```

### 4.4 Event/Callback System

Event types:
- `run.started`, `run.step`, `run.completed`, `run.failed`
- `tool.started`, `tool.completed`, `tool.failed`
- `workflow.node.started`, `workflow.node.completed`, `workflow.node.failed`

Callback interface:

```python
class EventCallback(Protocol):
    async def __call__(self, event_name: str, payload: dict) -> None: ...
```

Default sinks:
- stdout logger
- JSONL trace writer
- OpenTelemetry exporter (optional)

## 5. Example Workflows

### 5.1 Research Agent (Web Search + Synthesis)

Goal: answer a research question with citations.

Flow:
1. `web_search(query)` gathers sources.
2. `fetch_url(url)` extracts content.
3. `synthesize_notes(chunks)` creates summary.
4. `write_file(path, markdown)` outputs report.

DAG:
- `web_search` -> parallel `fetch_url[*]` -> `synthesize_notes` -> `write_file`

### 5.2 Coding Agent (File Operations + Execution)

Goal: implement code change and verify tests.

Flow:
1. `read_repo_structure()`
2. `read_files(targets)`
3. `apply_patch(changes)`
4. `run_tests(pattern)`
5. `summarize_diff()`

Policy controls:
- Write allowlist paths only
- Block destructive shell commands by default
- Capture test outputs as artifacts

### 5.3 Multi-Agent Collaboration

Agents:
- PlannerAgent: decomposes request into task graph
- SpecialistAgent(s): execute domain tasks (research, coding, QA)
- ReviewerAgent: validates outputs and merges

Collaboration mechanism:
- Shared state store + message queue (`AgentMessage` model)
- Explicit handoff events and acceptance criteria
- Final arbiter merges artifacts into one `RunResult`

## 6. Testing Strategy

### 6.1 Unit Tests
- `test_tool_registry.py`
  - registration, duplicate detection, validation failures
- `test_agent_loop.py`
  - final-answer path, max-step path, tool-invocation path
- `test_state_manager.py`
  - checkpoints, resume behavior, final persistence
- `test_mcp_client.py`
  - tool discovery, response normalization, error mapping

### 6.2 Integration Tests
- Workflow DAG execution with parallel branches
- Retry/failure policies (`fail_fast`, `best_effort`)
- End-to-end run with mocked LLM and local tools
- Resume from checkpoint after injected crash

### 6.3 Mock LLM for Deterministic Testing

```python
class MockLLM:
    def __init__(self, scripted_actions):
        self.scripted_actions = scripted_actions

    async def next_action(self, task: str, state: dict):
        return self.scripted_actions.pop(0)
```

Benefits:
- repeatable decisions
- no external API cost
- deterministic regression coverage

### 6.4 pytest Layout

```text
tests/
  unit/
    test_agent_loop.py
    test_tool_registry.py
    test_state_manager.py
    test_mcp_client.py
  integration/
    test_research_workflow.py
    test_coding_workflow.py
    test_multi_agent_flow.py
  fixtures/
    mock_llm.py
    sample_workflows.py
```

## 7. Packaging & Distribution

### 7.1 PyPI Package Structure

```text
src/ai_agent_workflow/
  __init__.py
  agent.py
  tools/
    __init__.py
    registry.py
    decorators.py
  workflow/
    __init__.py
    engine.py
    dsl.py
  state/
    __init__.py
    manager.py
    stores/
      sqlite.py
      postgres.py
  mcp/
    __init__.py
    client.py
  cli.py
```

### 7.2 `pyproject.toml` Baseline

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "ai-agent-workflow"
version = "0.1.0"
description = "Async AI agent framework with tools, workflows, and MCP integration"
requires-python = ">=3.11"
dependencies = ["pydantic>=2", "httpx>=0.27"]

[project.scripts]
agentwf = "ai_agent_workflow.cli:main"
```

### 7.3 CLI Entry Point
- `agentwf run --task "..." --workflow examples/research.yaml`
- `agentwf tools list`
- `agentwf workflow validate path/to/workflow.yaml`

### 7.4 Docker Support
- Multi-stage image (`python:3.11-slim`)
- Non-root runtime user
- Healthcheck for service mode
- Optional profile for MCP sidecar connections

## 8. State Management and Persistence Design

### 8.1 Data Model
- `runs` table: metadata and terminal status
- `run_events` table: append-only event log
- `checkpoints` table: serialized state snapshots
- `artifacts` table: pointers to files/blobs

### 8.2 Consistency Model
- Event-sourced append for auditability
- Checkpoint every N steps or on workflow node completion
- Idempotency key per tool call to prevent duplicate side effects

### 8.3 Recovery Strategy
1. Load latest checkpoint for `run_id`
2. Rehydrate pending DAG nodes
3. Skip idempotent-complete calls
4. Resume scheduler from durable state

## 9. Security and Operational Considerations
- Tool permission model (read/write/exec/network scopes)
- Secret management via environment variables and vault injection
- PII redaction on logs/events
- Rate limits and circuit breakers for external APIs
- Structured audit trail for every tool invocation

## 10. Implementation Roadmap

### Phase 1 (Week 1)
- Agent core loop
- Tool decorator + registry
- Local state manager (SQLite)

### Phase 2 (Week 2)
- Workflow DAG engine with parallel execution
- Event bus and callbacks
- Basic CLI

### Phase 3 (Week 3)
- MCP client integration
- Multi-agent collaboration primitives
- Integration tests and docs polish

### Phase 4 (Week 4)
- Packaging hardening
- Docker image and CI release pipeline
- Performance tuning and observability

## 11. Acceptance Criteria Mapping
- Agent framework class architecture with code examples: covered in Sections 1 and 3.
- Tool system with `@tool` decorator implementation: Section 3.2 and 4.2.
- Workflow DAG orchestration design: Sections 3.3 and 5.
- MCP client integration: Sections 3.5 and 9.
- State management with persistence: Sections 3.4 and 8.
- Three complete example workflows: Section 5.
- PyPI packaging setup: Section 7.
- Testing strategy with pytest: Section 6.

## 12. Risks and Mitigations
- Risk: Non-deterministic model decisions break reproducibility.
  - Mitigation: scripted mock LLM + checkpointed transitions.
- Risk: Tool side effects during retries.
  - Mitigation: idempotency keys + compensating actions.
- Risk: MCP server variability.
  - Mitigation: capability probing, timeout budgets, fallback tools.

