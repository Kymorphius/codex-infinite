"""Read-only native project/history inventory. JSON configuration on stdin."""
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path


def inventory(config):
    home = Path(config["codexHome"]).expanduser().resolve()
    state = json.loads((home / ".codex-global-state.json").read_text())
    project_id = config["projectId"]
    project = state.get("local-projects", {}).get(project_id)
    if not project:
        raise ValueError("Exact native project ID was not found")
    assigned = {
        tid for tid, value in state.get("thread-project-assignments", {}).items()
        if isinstance(value, dict) and value.get("projectId") == project_id
    }
    mappings = state.get("app-server-project-id-by-legacy-project-id-by-host", {})
    server_ids = {value[project_id] for value in mappings.values()
                  if isinstance(value, dict) and project_id in value}
    connection = sqlite3.connect((home / "state_5.sqlite").as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = {row["id"]: dict(row) for row in connection.execute(
            "select id,rollout_path,cwd,title,name,archived,source,project_id from threads"
        )}
    finally:
        connection.close()
    assigned.update(tid for tid, row in rows.items() if row["project_id"] in server_ids)
    selected = set(assigned)
    parents = {}
    for tid, row in rows.items():
        try:
            source = json.loads(row["source"])
            parents[tid] = source.get("subagent", {}).get("thread_spawn", {}).get("parent_thread_id")
        except (ValueError, AttributeError, TypeError):
            pass
    while True:
        before = len(selected)
        selected.update(tid for tid, parent in parents.items() if parent in selected)
        if len(selected) == before:
            break
    sessions = []
    for tid in sorted(selected):
        if tid not in rows:
            raise ValueError("Assigned history has no native index: " + tid)
        row = rows[tid]
        source_path = Path(row["rollout_path"])
        relative = source_path.resolve().relative_to(home)
        if relative.parts[0] not in ("sessions", "archived_sessions"):
            raise ValueError("Rollout path outside allowed native session trees")
        if source_path.is_symlink() or not source_path.is_file():
            raise ValueError("Rollout must be a regular file: " + tid)
        before = source_path.stat()
        full_hash, body_hash = hashlib.sha256(), hashlib.sha256()
        with source_path.open("rb") as stream:
            header = stream.readline(4 * 1024 * 1024)
            if not header.endswith(b"\n"):
                raise ValueError("Invalid or oversized session metadata: " + tid)
            meta = json.loads(header)
            payload = meta.get("payload", {})
            if meta.get("type") != "session_meta" or (payload.get("id") or payload.get("session_id")) != tid:
                raise ValueError("Rollout/index identity mismatch: " + tid)
            full_hash.update(header)
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                full_hash.update(chunk)
                body_hash.update(chunk)
        after = source_path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("Source history changed during inventory: " + tid)
        sessions.append({
            "sourceThreadId": tid, "relativePath": str(relative),
            "timestamp": payload.get("timestamp") or meta.get("timestamp"),
            "cwd": row["cwd"], "title": row["name"] or row["title"],
            "archived": bool(row["archived"]), "isProjectThread": tid in assigned,
            "parentId": parents.get(tid), "bytes": before.st_size,
            "mtimeNs": before.st_mtime_ns, "sha256": full_hash.hexdigest(),
            "bodySha256": body_hash.hexdigest(),
        })
    return {"version": 1, "projectId": project_id, "projectName": project["name"],
            "roots": project["rootPaths"], "sessions": sessions}


if __name__ == "__main__":
    print(json.dumps(inventory(json.load(sys.stdin)), ensure_ascii=False))
