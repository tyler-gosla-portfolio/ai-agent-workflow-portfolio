# PROJECT 2: AI Agent Workflow System
## Design Brief for Codex 5.3

### Objective
Build a Python-based AI agent framework with tool calling and workflow orchestration that demonstrates AI infrastructure engineering skills.

### Target Job Matches
- Upwork: "AI Agent Infrastructure Developer" ($500 fixed)
- Wellfound: "AI/LLM Full-Stack Engineer" ($250k-$300k)
- GitHub Bounties: MCP/tool integration work ($2k-$3.5k)

### Tech Stack
- **Language:** Python 3.11+
- **Core:** Pydantic, asyncio, httpx
- **LLM:** OpenAI, Anthropic, local model support
- **Protocol:** MCP (Model Context Protocol)
- **Testing:** pytest, pytest-asyncio
- **Distribution:** setuptools, PyPI

### Core Features
1. **Agent Base Class**
   - Tool registration via decorators
   - Context management
   - Multi-step reasoning
   - Async execution

2. **Tool System**
   - @tool decorator for registration
   - Automatic schema generation (Pydantic)
   - Built-in tools: web_search, file_read, execute_code
   - Custom tool support

3. **Workflow Orchestration**
   - DAG-based execution
   - State management
   - Error handling / retries
   - Parallel execution support

4. **MCP Integration**
   - MCP client implementation
   - Tool server discovery
   - Resource access

5. **Multi-Agent Support**
   - Agent-to-agent communication
   - Role-based agents
   - Collaboration patterns

### Architecture Components
```python
# Core Classes
class Agent:
    - tools: Dict[str, Tool]
    - llm_client: LLMClient
    - state: StateManager
    - run(task: str) -> Result

class Tool:
    - name: str
    - description: str
    - parameters: BaseModel
    - execute(**kwargs) -> Any

class Workflow:
    - steps: List[Step]
    - dependencies: DAG
    - execute(context: Context) -> Result

class MCPClient:
    - connect(server_url: str)
    - list_tools() -> List[Tool]
    - call_tool(name: str, params: dict)
```

### Example Usage
```python
from agent_framework import Agent, tool

@tool
def web_search(query: str) -> str:
    """Search the web for information"""
    ...

@tool  
def read_file(path: str) -> str:
    """Read file contents"""
    ...

agent = Agent(
    name="ResearchAgent",
    tools=[web_search, read_file],
    model="gpt-4"
)

result = agent.run("Research Python async patterns and save to file")
```

### Design Document Structure
Create `docs/DESIGN.md` with:
1. System Architecture (component diagram)
2. Core Abstractions (Agent, Tool, Workflow classes)
3. Tool System Design (decorator pattern, schema gen)
4. Workflow Engine (DAG execution, state management)
5. MCP Integration (protocol compliance)
6. Multi-Agent Communication (message passing)
7. LLM Client Abstraction (multi-provider support)
8. Testing Strategy (unit, integration, mocks)
9. Packaging & Distribution (PyPI, CLI)
10. Example Workflows (3 complete examples)

### Success Criteria
- [ ] Modular, extensible architecture
- [ ] Clear abstraction layers
- [ ] Type-safe with Pydantic
- [ ] Async-first design
- [ ] Comprehensive examples
- [ ] 2-hour timebox

### Output
Save complete design to:
`~/portfolio-projects/ai-agent-workflow-portfolio/docs/DESIGN.md`
