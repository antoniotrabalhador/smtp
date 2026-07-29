from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from sqlmodel import select

from app.cloudflare_api import cf_api_request, cf_delete_record, cf_find_zone_id
from app.db import get_session
from app.models import (
    CloudflareConfig,
    CloudflareConfigRead,
    CloudflareConfigUpdate,
    CloudflareDomain,
    CloudflareDomainCreate,
    CloudflareDomainRead,
    Node,
)

router = APIRouter(prefix="/api/cloudflare", tags=["cloudflare"])


def _get_or_create_config(session: Session) -> CloudflareConfig:
    cfg = session.get(CloudflareConfig, 1)
    if cfg:
        return cfg
    cfg = CloudflareConfig(id=1)
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return cfg


@router.get("/config", response_model=CloudflareConfigRead)
def get_config(session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    return CloudflareConfigRead(
        has_token=bool(cfg.api_token),
        zone_id=cfg.zone_id,
        updated_at=cfg.updated_at,
    )


@router.put("/config", response_model=CloudflareConfigRead)
def update_config(payload: CloudflareConfigUpdate, session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    changed = False

    if payload.clear_token:
        cfg.api_token = None
        cfg.zone_id = None
        for db_domain in session.exec(select(CloudflareDomain)).all():
            session.delete(db_domain)
        for db_node in session.exec(select(Node).where(Node.cloudflare_domain_id.is_not(None))).all():
            db_node.cloudflare_domain_id = None
            db_node.domain = None
            db_node.email_from = None
            session.add(db_node)
        changed = True

    if payload.api_token is not None:
        cfg.api_token = payload.api_token.strip() or None
        changed = True

    if payload.zone_id is not None:
        cfg.zone_id = payload.zone_id.strip() or None
        changed = True

    if not changed:
        raise HTTPException(status_code=400, detail="Nenhuma alteração enviada")

    cfg.updated_at = datetime.utcnow()
    session.add(cfg)
    session.commit()
    session.refresh(cfg)
    return CloudflareConfigRead(
        has_token=bool(cfg.api_token),
        zone_id=cfg.zone_id,
        updated_at=cfg.updated_at,
    )


@router.post("/config/test")
def test_config(payload: dict | None = None, session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    if not cfg.api_token:
        raise HTTPException(status_code=400, detail="Token não configurado")

    try:
        verify = cf_api_request(cfg.api_token, "GET", "/user/tokens/verify")
        token_status = (verify.get("result") or {}).get("status", "unknown")
        zone_id = cfg.zone_id
        if not zone_id and payload and payload.get("domain"):
            zone_id = cf_find_zone_id(cfg.api_token, str(payload["domain"]).strip())
        zone_name = None
        if zone_id:
            zone_data = cf_api_request(cfg.api_token, "GET", f"/zones/{zone_id}")
            zone_name = (zone_data.get("result") or {}).get("name")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return {
        "success": True,
        "token_status": token_status,
        "zone_id": zone_id,
        "zone_name": zone_name,
    }


@router.get("/domains", response_model=list[CloudflareDomainRead])
def list_domains(session: Session = Depends(get_session)):
    return session.exec(select(CloudflareDomain).order_by(CloudflareDomain.domain.asc())).all()


@router.post("/domains", response_model=CloudflareDomainRead)
def create_domain(payload: CloudflareDomainCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(CloudflareDomain).where(CloudflareDomain.domain == payload.domain)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Domínio já cadastrado")
    zone_id = payload.zone_id or None
    if not zone_id:
        cfg = _get_or_create_config(session)
        if cfg.api_token:
            try:
                zone_id = cf_find_zone_id(cfg.api_token, payload.domain)
            except RuntimeError:
                zone_id = None
    db_domain = CloudflareDomain(domain=payload.domain, zone_id=zone_id)
    session.add(db_domain)
    session.commit()
    session.refresh(db_domain)
    return db_domain


@router.delete("/domains/{domain_id}", status_code=204)
def delete_domain(domain_id: int, session: Session = Depends(get_session)):
    db_domain = session.get(CloudflareDomain, domain_id)
    if not db_domain:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")
    linked_node = session.exec(select(Node).where(Node.cloudflare_domain_id == domain_id)).first()
    if linked_node:
        raise HTTPException(status_code=400, detail="Domínio vinculado a uma VPS. Remova o vínculo antes de excluir.")
    session.delete(db_domain)
    session.commit()


@router.get("/zones")
def list_cloudflare_zones(session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    if not cfg.api_token:
        raise HTTPException(status_code=400, detail="Token não configurado")
    try:
        data = cf_api_request(cfg.api_token, "GET", "/zones?per_page=200")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    zones = []
    for z in data.get("result", []):
        zones.append({"id": z.get("id"), "name": z.get("name"), "status": z.get("status")})
    zones.sort(key=lambda x: (x["name"] or ""))
    return {"zones": zones}


@router.post("/domains/import")
def import_cloudflare_zones(session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    if not cfg.api_token:
        raise HTTPException(status_code=400, detail="Token não configurado")
    try:
        data = cf_api_request(cfg.api_token, "GET", "/zones?per_page=200")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    existing = {d.domain.lower(): d for d in session.exec(select(CloudflareDomain)).all()}
    created = 0
    updated = 0
    for z in data.get("result", []):
        name = (z.get("name") or "").strip().lower()
        zone_id = z.get("id")
        if not name or not zone_id:
            continue
        if name in existing:
            db_domain = existing[name]
            if db_domain.zone_id != zone_id:
                db_domain.zone_id = zone_id
                session.add(db_domain)
                updated += 1
            continue
        session.add(CloudflareDomain(domain=name, zone_id=zone_id))
        created += 1
    session.commit()
    return {"success": True, "created": created, "updated": updated, "total": len(data.get("result", []))}


@router.get("/domains/{domain_id}/records")
def list_domain_records(domain_id: int, session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    if not cfg.api_token:
        raise HTTPException(status_code=400, detail="Token não configurado")

    db_domain = session.get(CloudflareDomain, domain_id)
    if not db_domain:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    zone_id = db_domain.zone_id
    if not zone_id:
        try:
            zone_id = cf_find_zone_id(cfg.api_token, db_domain.domain)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        db_domain.zone_id = zone_id
        session.add(db_domain)
        session.commit()

    try:
        data = cf_api_request(cfg.api_token, "GET", f"/zones/{zone_id}/dns_records?per_page=500")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    records = []
    for rec in data.get("result", []):
        records.append(
            {
                "id": rec.get("id"),
                "type": rec.get("type"),
                "name": rec.get("name"),
                "content": rec.get("content"),
                "ttl": rec.get("ttl"),
                "proxied": rec.get("proxied"),
                "priority": rec.get("priority"),
            }
        )
    records.sort(key=lambda r: (r["name"] or "", r["type"] or ""))
    return {"domain": db_domain.domain, "zone_id": zone_id, "records": records}


@router.delete("/domains/{domain_id}/records/{record_id}", status_code=204)
def delete_domain_record(domain_id: int, record_id: str, session: Session = Depends(get_session)):
    cfg = _get_or_create_config(session)
    if not cfg.api_token:
        raise HTTPException(status_code=400, detail="Token não configurado")

    db_domain = session.get(CloudflareDomain, domain_id)
    if not db_domain:
        raise HTTPException(status_code=404, detail="Domínio não encontrado")

    zone_id = db_domain.zone_id
    if not zone_id:
        try:
            zone_id = cf_find_zone_id(cfg.api_token, db_domain.domain)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=str(e))
        db_domain.zone_id = zone_id
        session.add(db_domain)
        session.commit()

    try:
        cf_delete_record(cfg.api_token, zone_id, record_id)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
