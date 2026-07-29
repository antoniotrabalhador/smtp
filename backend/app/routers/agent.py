import json
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import text
from sqlmodel import Session, select

from app.db import get_session, engine
from app.models import Campaign, CampaignShard, EmailTemplate, Node, Task, TaskCreate, TaskRead, generate_token

router = APIRouter(prefix="/api/agent", tags=["agent"])


def _get_node_by_token(token: str, session: Session) -> Node:
    node = session.exec(select(Node).where(Node.agent_token == token)).first()
    if not node:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    return node


def _dispatch_shard_chunk(shard: CampaignShard, node: Node, session: Session) -> Task | None:
    """Create the next chunk task for a shard. Returns None if shard is exhausted."""
    campaign = session.get(Campaign, shard.campaign_id)
    if not campaign:
        return None

    template = session.get(EmailTemplate, campaign.template_id)
    if not template:
        return None

    chunk_end = min(shard.next_row_index + shard.chunk_size, shard.offset_end)
    if shard.next_row_index >= shard.offset_end:
        shard.status = "done"
        shard.finished_at = datetime.utcnow()
        session.add(shard)
        session.commit()
        return None

    # Fetch active recipients for this chunk window
    rows = session.exec(
        text(
            "SELECT email FROM recipient "
            "WHERE list_id = :list_id AND status = 'active' "
            "AND row_index >= :start AND row_index < :end "
            "ORDER BY row_index"
        ).bindparams(list_id=shard.list_id, start=shard.next_row_index, end=chunk_end)
    ).all()

    recipients = [r[0] for r in rows]

    # Advance cursor even if no active recipients in this window (skip inactive range)
    shard.next_row_index = chunk_end
    shard.status = "running"

    if not recipients:
        # No active recipients in this window — check if shard is now done
        if shard.next_row_index >= shard.offset_end:
            shard.status = "done"
            shard.finished_at = datetime.utcnow()
        session.add(shard)
        session.commit()
        return None

    unsub_url = ""
    if node.domain and node.id:
        unsub_url = f"https://{node.domain}/unsubscribe?email={{{{email}}}}&node_id={node.id}"

    feedback_id = f"campaign{campaign.id}:{node.domain or 'local'}:node{node.id}:goog"

    task = Task(
        node_id=node.id,
        campaign_id=campaign.id,
        shard_id=shard.id,
        subject=campaign.subject,
        body=template.plain_text or "",
        html=template.html,
        plain_text=template.plain_text,
        from_address=node.email_from,
        recipients=json.dumps(recipients),
        rate_per_hour=campaign.rate_per_hour,
        unsubscribe_url=unsub_url,
        feedback_id=feedback_id,
        cta_url=campaign.cta_url,
    )
    session.add(task)
    shard.current_task_id = None  # will update after commit
    session.add(shard)
    session.commit()
    session.refresh(task)

    shard.current_task_id = task.id
    session.add(shard)
    session.commit()

    return task


@router.get("/tasks")
def poll_tasks(node_id: int, x_agent_token: str = Header(...), session: Session = Depends(get_session)):
    """Agent polls for the next pending task."""
    node = _get_node_by_token(x_agent_token, session)
    if node.id != node_id:
        raise HTTPException(status_code=403, detail="Token/node_id mismatch")

    # 1. Check for manual/test tasks first (no shard)
    task = session.exec(
        select(Task).where(Task.node_id == node_id, Task.status == "pending", Task.shard_id == None)
        .order_by(Task.created_at)
    ).first()

    if task:
        task.status = "running"
        session.add(task)
        session.commit()
        session.refresh(task)
    else:
        # 2. Check for active campaign shards
        shard = session.exec(
            select(CampaignShard).where(
                CampaignShard.node_id == node_id,
                CampaignShard.status.in_(["pending", "running"]),
            ).order_by(CampaignShard.created_at)
        ).first()

        if not shard:
            from fastapi.responses import Response
            return Response(status_code=204)

        # Don't dispatch a new chunk if one is already running for this shard
        if shard.current_task_id:
            existing = session.get(Task, shard.current_task_id)
            if existing and existing.status in ("pending", "running"):
                from fastapi.responses import Response
                return Response(status_code=204)

        task = _dispatch_shard_chunk(shard, node, session)
        if not task:
            from fastapi.responses import Response
            return Response(status_code=204)

    # Build unsubscribe_url if not set
    unsub_url = task.unsubscribe_url or ""
    if not unsub_url and node.domain and node.id:
        unsub_url = f"https://{node.domain}/unsubscribe?email={{{{email}}}}&node_id={node.id}"

    feedback_id = task.feedback_id or ""
    if not feedback_id and node.domain:
        feedback_id = f"task{task.id}:{node.domain}:node{node.id}:goog"

    return {
        "id": task.id,
        "subject": task.subject,
        "body": task.body,
        "html": task.html or "",
        "plain_text": task.plain_text or task.body,
        "from_address": task.from_address,
        "recipients": json.loads(task.recipients),
        "rate_per_hour": task.rate_per_hour,
        "unsubscribe_url": unsub_url,
        "feedback_id": feedback_id,
        "cta_url": task.cta_url or "",
    }


@router.post("/tasks/{task_id}/report")
def report_task(
    task_id: int,
    payload: dict,
    x_agent_token: str = Header(...),
    session: Session = Depends(get_session),
):
    """Agent reports task completion."""
    node = _get_node_by_token(x_agent_token, session)
    task = session.get(Task, task_id)
    if not task or task.node_id != node.id:
        raise HTTPException(status_code=404, detail="Task not found")

    sent = payload.get("sent_count", 0)
    errors = payload.get("error_count", 0)

    task.sent_count = sent
    task.error_count = errors
    task.task_log = payload.get("log", "")
    task.status = "failed" if errors > 0 and sent == 0 else "done"
    task.finished_at = datetime.utcnow()
    session.add(task)

    # Advance shard if this task belongs to one
    if task.shard_id:
        shard = session.get(CampaignShard, task.shard_id)
        if shard:
            shard.sent_count += sent
            shard.error_count += errors
            shard.current_task_id = None
            # If next_row_index already advanced by _dispatch_shard_chunk, just
            # check if the shard is now exhausted
            if shard.next_row_index >= shard.offset_end:
                shard.status = "done"
                shard.finished_at = datetime.utcnow()
            else:
                shard.status = "pending"  # ready for next chunk
            session.add(shard)

    session.commit()
    return {"ok": True}


@router.post("/heartbeat")
def heartbeat(
    node_id: int,
    payload: dict,
    x_agent_token: str = Header(...),
    session: Session = Depends(get_session),
):
    """Agent signals it's alive."""
    node = _get_node_by_token(x_agent_token, session)
    if node.id != node_id:
        raise HTTPException(status_code=403, detail="Token/node_id mismatch")

    node.agent_status = payload.get("status", "online")
    node.agent_last_seen = datetime.utcnow()
    session.add(node)
    session.commit()
    return {"ok": True}


router = APIRouter(prefix="/api/agent", tags=["agent"])


def _get_node_by_token(token: str, session: Session) -> Node:
    node = session.exec(select(Node).where(Node.agent_token == token)).first()
    if not node:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    return node


@router.get("/tasks")
def poll_tasks(node_id: int, x_agent_token: str = Header(...), session: Session = Depends(get_session)):
    """Agent polls for the next pending task."""
    node = _get_node_by_token(x_agent_token, session)
    if node.id != node_id:
        raise HTTPException(status_code=403, detail="Token/node_id mismatch")

    task = session.exec(
        select(Task).where(Task.node_id == node_id, Task.status == "pending")
        .order_by(Task.created_at)
    ).first()

    if not task:
        from fastapi.responses import Response
        return Response(status_code=204)

    task.status = "running"
    session.add(task)
    session.commit()
    session.refresh(task)

    # Build unsubscribe_url from node domain if not set on task
    unsub_url = task.unsubscribe_url or ""
    if not unsub_url and node.domain and node.id:
        unsub_url = f"https://{node.domain}/unsubscribe?email={{{{email}}}}&node_id={node.id}"

    # Auto-generate Feedback-ID if not set: campaignID:domain:nodeN:goog
    feedback_id = task.feedback_id or ""
    if not feedback_id and node.domain:
        feedback_id = f"task{task.id}:{node.domain}:node{node.id}:goog"

    return {
        "id": task.id,
        "subject": task.subject,
        "body": task.body,
        "html": task.html or "",
        "plain_text": task.plain_text or task.body,
        "from_address": task.from_address,
        "recipients": json.loads(task.recipients),
        "rate_per_hour": task.rate_per_hour,
        "unsubscribe_url": unsub_url,
        "feedback_id": feedback_id,
        "cta_url": task.cta_url or "",
    }


@router.post("/tasks/{task_id}/report")
def report_task(
    task_id: int,
    payload: dict,
    x_agent_token: str = Header(...),
    session: Session = Depends(get_session),
):
    """Agent reports task completion."""
    node = _get_node_by_token(x_agent_token, session)
    task = session.get(Task, task_id)
    if not task or task.node_id != node.id:
        raise HTTPException(status_code=404, detail="Task not found")

    task.sent_count = payload.get("sent_count", 0)
    task.error_count = payload.get("error_count", 0)
    task.task_log = payload.get("log", "")
    task.status = "failed" if task.error_count > 0 and task.sent_count == 0 else "done"
    task.finished_at = datetime.utcnow()
    session.add(task)
    session.commit()
    return {"ok": True}


@router.post("/heartbeat")
def heartbeat(
    node_id: int,
    payload: dict,
    x_agent_token: str = Header(...),
    session: Session = Depends(get_session),
):
    """Agent signals it's alive."""
    node = _get_node_by_token(x_agent_token, session)
    if node.id != node_id:
        raise HTTPException(status_code=403, detail="Token/node_id mismatch")

    node.agent_status = payload.get("status", "online")
    node.agent_last_seen = datetime.utcnow()
    session.add(node)
    session.commit()
    return {"ok": True}
