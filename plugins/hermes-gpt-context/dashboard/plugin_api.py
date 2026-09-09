"""Authenticated, read-only dashboard adapter for the local GPT context service."""
import asyncio
import json
from pathlib import Path
import shutil

from fastapi import APIRouter, HTTPException, Query

router = APIRouter()
ROOT = Path(__file__).resolve().parents[3]


async def query_context(method: str, params: dict):
    if method not in {"listProjects", "searchConversations", "readConversation"}:
        raise HTTPException(400, "不支持的查询。")
    bundled_node = Path.home() / ".hermes/node/bin/node"
    node = str(bundled_node) if bundled_node.is_file() else shutil.which("node")
    if not node:
        raise HTTPException(503, "未找到本机 GPT 上下文运行环境。")
    proc = await asyncio.create_subprocess_exec(
        node, str(ROOT / "scripts/hermes-context-query.mjs"), cwd=str(ROOT),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        output, _ = await asyncio.wait_for(
            proc.communicate(json.dumps({"method": method, "params": params}).encode()), 20
        )
        if len(output) > 524288:
            raise HTTPException(502, "查询结果过大。")
        value = json.loads(output)
        if proc.returncode:
            raise HTTPException(400, value.get("error", "读取上下文失败。"))
        return value
    except asyncio.TimeoutError as exc:
        raise HTTPException(504, "读取超时，请重试。") from exc
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(502, "上下文服务返回无效数据。") from exc
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()


@router.get("/projects")
async def projects(offset: int = Query(0, ge=0, le=10000)):
    return await query_context("listProjects", {"limit": 100, "offset": offset})


@router.get("/conversations")
async def conversations(query: str = Query("", max_length=200), projectId: str | None = None,
                        offset: int = Query(0, ge=0, le=10000)):
    params = {"query": query, "offset": offset, "limit": 50}
    if projectId:
        params["projectId"] = projectId
    return await query_context("searchConversations", params)


@router.get("/conversation/{conversation_id}")
async def conversation(conversation_id: str, cursor: str | None = Query(None, max_length=1500)):
    params = {"conversationId": conversation_id, "limit": 12, "maxMessageChars": 2500}
    if cursor:
        params["cursor"] = cursor
    return await query_context("readConversation", params)
