# pane_mailbox/api.pyi
from typing import Dict, List, Optional, Protocol, TypedDict, Literal

EnvelopeType = Literal["dispatch", "wake", "eval", "abort"]
Priority = Literal["P0", "P1", "P2"]
ResultStatus = Literal["passed", "failed", "aborted", "timeout"]


class TaskEnvelope(TypedDict, total=False):
    envelope_version: str
    task_id: str
    sprint_id: str
    node_id: str
    actor_id: str
    operator_id: Optional[str]
    payload: dict
    submitted_at: str
    ttl_sec: int
    priority: Priority
    preemptible: bool
    trace: dict


class ResultEnvelope(TypedDict, total=False):
    envelope_version: str
    task_id: str
    actor_id: str
    status: ResultStatus
    exit_code: int
    started_at: str
    finished_at: str
    duration_sec: float
    artifacts: List[str]
    evidence: dict
    error: Optional[dict]


class MailboxClient(Protocol):
    def submit(self, env: TaskEnvelope) -> str: ...

    def collect(self, actor_id: str, task_id: str, timeout_sec: float = 0.0) -> Optional[ResultEnvelope]: ...

    def abort(self, actor_id: str, task_id: str) -> bool: ...

    def poll(self, actor_id: str, max_n: int = 1) -> List[TaskEnvelope]: ...

    def report(self, actor_id: str, result: ResultEnvelope) -> None: ...

    def heartbeat(self, actor_id: str, payload: dict) -> None: ...

    def set_state(self, actor_id: str, state: dict) -> None: ...

    def read_state(self, actor_id: str) -> Optional[dict]: ...

    def read_heartbeat(self, actor_id: str) -> Optional[dict]: ...

    def list_pending(self, actor_id: str) -> list[str]: ...


class DuplicateTaskError(Exception): ...

class EnvelopeSchemaError(Exception): ...

class ActorNotFoundError(Exception): ...

class MailboxIOError(Exception): ...
