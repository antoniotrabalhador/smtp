import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlmodel import Session, select

from app.db import get_session
from app.models import (
    WebhookColumnMapping,
    WebhookConfigurePayload,
    WebhookEndpoint,
    WebhookEndpointCreate,
    WebhookEndpointRead,
    WebhookLead,
    generate_token,
)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


def _extract_field(data: Any, path: str) -> Optional[str]:
    parts = path.split(".")
    val = data
    for part in parts:
        if not isinstance(val, dict):
            return None
        val = val.get(part)
    return str(val).strip() if val is not None else None


def _get_mappings(webhook_id: int, session: Session) -> List[WebhookColumnMapping]:
    return session.exec(
        select(WebhookColumnMapping)
        .where(WebhookColumnMapping.webhook_id == webhook_id)
        .order_by(WebhookColumnMapping.sort_order)
    ).all()


def _serialize(wh: WebhookEndpoint, mappings: List[WebhookColumnMapping], session: Session) -> dict:
    last_id = getattr(wh, "last_exported_lead_id", None) or 0
    try:
        new_count = session.exec(
            text("SELECT COUNT(*) FROM webhooklead WHERE webhook_id = :wid AND id > :lid").bindparams(wid=wh.id, lid=last_id)
        ).one()[0]
    except Exception:
        new_count = 0

    return {
        "id": wh.id,
        "name": wh.name,
        "token": wh.token,
        "status": wh.status,
        "sample_payload": wh.sample_payload,
        "total_received": wh.total_received,
        "last_exported_at": getattr(wh, "last_exported_at", None),
        "last_exported_lead_id": getattr(wh, "last_exported_lead_id", None),
        "new_leads_count": new_count,
        "created_at": wh.created_at,
        "mappings": [
            {
                "id": m.id,
                "column_name": m.column_name,
                "json_path": m.json_path,
                "is_email": m.is_email,
                "sort_order": m.sort_order,
            }
            for m in mappings
        ],
    }


# ── Management ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[WebhookEndpointRead])
def list_webhooks(session: Session = Depends(get_session)):
    webhooks = session.exec(
        select(WebhookEndpoint).order_by(WebhookEndpoint.created_at.desc())
    ).all()
    return [_serialize(wh, _get_mappings(wh.id, session), session) for wh in webhooks]


@router.get("/{webhook_id}", response_model=WebhookEndpointRead)
def get_webhook(webhook_id: int, session: Session = Depends(get_session)):
    wh = session.get(WebhookEndpoint, webhook_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook não encontrado")
    return _serialize(wh, _get_mappings(wh.id, session), session)


@router.post("", response_model=WebhookEndpointRead, status_code=201)
def create_webhook(payload: WebhookEndpointCreate, session: Session = Depends(get_session)):
    wh = WebhookEndpoint(
        name=payload.name.strip(),
        token=generate_token(),
        status="pending_config",
    )
    session.add(wh)
    session.commit()
    session.refresh(wh)
    return _serialize(wh, [], session)


@router.patch("/{webhook_id}/configure", response_model=WebhookEndpointRead)
def configure_webhook(
    webhook_id: int,
    payload: WebhookConfigurePayload,
    session: Session = Depends(get_session),
):
    wh = session.get(WebhookEndpoint, webhook_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook não encontrado")

    session.exec(
        text("DELETE FROM webhookcolumnmapping WHERE webhook_id = :wid").bindparams(wid=webhook_id)
    )

    new_mappings = []
    for i, item in enumerate(payload.mappings):
        m = WebhookColumnMapping(
            webhook_id=webhook_id,
            column_name=item.column_name.strip(),
            json_path=item.json_path.strip(),
            is_email=item.is_email,
            sort_order=i,
        )
        session.add(m)
        new_mappings.append(m)

    wh.status = "active"
    session.add(wh)
    session.commit()
    session.refresh(wh)
    return _serialize(wh, new_mappings, session)


@router.delete("/{webhook_id}", status_code=204)
def delete_webhook(webhook_id: int, session: Session = Depends(get_session)):
    wh = session.get(WebhookEndpoint, webhook_id)
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook não encontrado")

    session.exec(
        text("DELETE FROM webhookcolumnmapping WHERE webhook_id = :wid").bindparams(wid=webhook_id)
    )
    session.exec(
        text("DELETE FROM webhooklead WHERE webhook_id = :wid").bindparams(wid=webhook_id)
    )
    session.delete(wh)
    session.commit()


@router.get("/{webhook_id}/leads")
def get_leads(webhook_id: int, limit: int = 100, session: Session = Depends(get_session)):
    if not session.get(WebhookEndpoint, webhook_id):
        raise HTTPException(status_code=404, detail="Webhook não encontrado")
    total = session.exec(
        text("SELECT COUNT(*) FROM webhooklead WHERE webhook_id = :wid").bindparams(wid=webhook_id)
    ).one()[0]
    leads = session.exec(
        select(WebhookLead)
        .where(WebhookLead.webhook_id == webhook_id)
        .order_by(WebhookLead.created_at.desc())
        .limit(limit)
    ).all()
    return {
        "total": total,
        "leads": [{"id": l.id, "data": l.data, "created_at": l.created_at} for l in leads],
    }


@router.get("/{webhook_id}/export-file")
def export_webhook_file(
    webhook_id: int,
    file_format: str = "csv",
    scope: str = "new",
    session: Session = Depends(get_session),
):
    try:
        wh = session.get(WebhookEndpoint, webhook_id)
        if not wh:
            raise HTTPException(status_code=404, detail="Webhook não encontrado")

        mappings = _get_mappings(webhook_id, session)
        if not mappings:
            raise HTTPException(status_code=400, detail="Webhook sem mapeamento de colunas configurado")

        last_id = getattr(wh, "last_exported_lead_id", None) or 0
        query = select(WebhookLead).where(WebhookLead.webhook_id == webhook_id)
        if scope == "new" and last_id:
            query = query.where(WebhookLead.id > last_id)

        leads = session.exec(query.order_by(WebhookLead.id.asc())).all()
        if not leads:
            raise HTTPException(status_code=404, detail="Nenhum lead encontrado para este filtro")

        columns = [m.column_name for m in mappings]
        output_lines = [";".join(columns)]
        max_id = last_id

        for lead in leads:
            if lead.id > max_id:
                max_id = lead.id
            try:
                row_data = json.loads(lead.data)
            except Exception:
                row_data = {}
            row_vals = [
                str(row_data.get(col, "") or "").replace(";", ",").replace("\n", " ").replace("\r", "")
                for col in columns
            ]
            output_lines.append(";".join(row_vals))

        if scope == "new" and leads:
            try:
                wh.last_exported_lead_id = max_id
                wh.last_exported_at = datetime.utcnow()
                session.add(wh)
                session.commit()
            except Exception:
                pass  # Fallback if DB columns not yet migrated

        content = "\n".join(output_lines)
        ext = "txt" if file_format.lower() == "txt" else "csv"
        media_type = "text/plain" if ext == "txt" else "text/csv"
        safe_name = "".join(c for c in wh.name if c.isalnum() or c in ("-", "_")).strip() or "webhook"
        filename = f"leads_{safe_name}_{scope}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.{ext}"

        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar: {str(exc)}")


# ── Public receiver ───────────────────────────────────────────────────────────

@router.post("/receive/{token}")
async def receive_webhook(token: str, request: Request, session: Session = Depends(get_session)):
    wh = session.exec(select(WebhookEndpoint).where(WebhookEndpoint.token == token)).first()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")

    # Parse body (JSON or form)
    try:
        data = await request.json()
    except Exception:
        try:
            form = await request.form()
            data = dict(form)
        except Exception:
            data = {}

    # Capture sample while not yet active
    if wh.status in ("pending_config", "configuring"):
        wh.sample_payload = json.dumps(data, ensure_ascii=False, indent=2)
        wh.status = "configuring"
        session.add(wh)
        session.commit()
        return {
            "ok": True,
            "status": "sample_captured",
            "message": "Payload capturado. Configure o mapeamento no painel.",
        }

    # Active: extract all mapped fields and store lead
    mappings = _get_mappings(wh.id, session)
    if not mappings:
        return JSONResponse({"ok": False, "error": "No mappings configured"}, status_code=422)

    extracted = {m.column_name: _extract_field(data, m.json_path) for m in mappings}

    # Dedup by email field if one is marked
    email_mappings = [m for m in mappings if m.is_email]
    if email_mappings:
        email_col = email_mappings[0].column_name
        email_val = extracted.get(email_col)
        if email_val:
            dup = session.exec(
                text(
                    f"SELECT id FROM webhooklead WHERE webhook_id = :wid "
                    f"AND json_extract(data, '$.{email_col}') = :val"
                ).bindparams(wid=wh.id, val=email_val)
            ).first()
            if dup:
                wh.total_received += 1
                session.add(wh)
                session.commit()
                return {"ok": True, "status": "duplicate", "data": extracted}

    session.add(WebhookLead(
        webhook_id=wh.id,
        data=json.dumps(extracted, ensure_ascii=False),
    ))
    wh.total_received += 1
    session.add(wh)
    session.commit()

    return {"ok": True, "status": "stored", "data": extracted}
