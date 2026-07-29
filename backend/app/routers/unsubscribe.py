from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlmodel import Session, func, select

from app.db import get_session
from app.models import UnsubscribeEntry

router = APIRouter(tags=["unsubscribe"])


def _record(session: Session, email: str, domain: Optional[str], node_id: Optional[int], source: str) -> None:
    existing = session.exec(
        select(UnsubscribeEntry).where(
            UnsubscribeEntry.email == email,
            UnsubscribeEntry.domain == domain,
        )
    ).first()
    if existing:
        return
    entry = UnsubscribeEntry(email=email, domain=domain, node_id=node_id, source=source)
    session.add(entry)
    session.commit()


CONFIRM_PAGE = """<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<title>Inscrição cancelada</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #f6f7f9; margin: 0;
        display: flex; align-items: center; justify-content: center; height: 100vh; }}
  .card {{ background: #fff; padding: 32px 40px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
          text-align: center; max-width: 380px; }}
  h1 {{ font-size: 1.2em; margin-bottom: 8px; color: #1a1a1a; }}
  p {{ color: #555; font-size: 0.95em; }}
</style>
</head>
<body>
  <div class="card">
    <h1>✓ Inscrição cancelada</h1>
    <p>O email <strong>{email}</strong> não receberá mais nossas mensagens.</p>
  </div>
</body>
</html>"""


INVALID_PAGE = """<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<title>Link inválido</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #f6f7f9; margin: 0;
        display: flex; align-items: center; justify-content: center; height: 100vh; }}
  .card {{ background: #fff; padding: 32px 40px; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.08);
          text-align: center; max-width: 380px; }}
  h1 {{ font-size: 1.2em; margin-bottom: 8px; color: #c0392b; }}
  p {{ color: #555; font-size: 0.95em; }}
</style>
</head>
<body>
  <div class="card">
    <h1>Link inválido</h1>
    <p>Este link de cancelamento é inválido ou expirou.<br>Para cancelar sua inscrição, clique no link do email que você recebeu.</p>
  </div>
</body>
</html>"""


@router.get("/unsubscribe")
def unsubscribe_get(
    email: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    node_id: Optional[int] = Query(None),
    session: Session = Depends(get_session),
):
    """Clique manual do usuário no link do email (ou botão do provedor)."""
    if not email:
        return Response(content=INVALID_PAGE, media_type="text/html", status_code=400)
    _record(session, email=email, domain=domain, node_id=node_id, source="link")
    return Response(content=CONFIRM_PAGE.format(email=email), media_type="text/html")


@router.post("/unsubscribe")
def unsubscribe_post(
    email: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    node_id: Optional[int] = Query(None),
    session: Session = Depends(get_session),
):
    """One-Click (RFC 8058): Gmail/Outlook fazem POST direto, sem abrir página."""
    if not email:
        return Response(status_code=400)
    _record(session, email=email, domain=domain, node_id=node_id, source="one-click")
    return Response(status_code=200)


@router.get("/api/unsubscribe/list")
def list_unsubscribed(
    node_id: Optional[int] = None,
    domain: Optional[str] = None,
    session: Session = Depends(get_session),
):
    query = select(UnsubscribeEntry)
    if node_id is not None:
        query = query.where(UnsubscribeEntry.node_id == node_id)
    if domain is not None:
        query = query.where(UnsubscribeEntry.domain == domain)
    query = query.order_by(UnsubscribeEntry.created_at.desc())
    return session.exec(query).all()


@router.get("/api/unsubscribe/count")
def count_unsubscribed(
    node_id: Optional[int] = None,
    domain: Optional[str] = None,
    session: Session = Depends(get_session),
):
    query = select(func.count()).select_from(UnsubscribeEntry)
    if node_id is not None:
        query = query.where(UnsubscribeEntry.node_id == node_id)
    if domain is not None:
        query = query.where(UnsubscribeEntry.domain == domain)
    total = session.exec(query).one()
    return {"count": total}


@router.get("/api/unsubscribe/check")
def check_unsubscribed(
    email: str,
    domain: Optional[str] = None,
    session: Session = Depends(get_session),
):
    """Usado pelo agente antes de enviar: retorna True se o email não deve receber."""
    query = select(UnsubscribeEntry).where(UnsubscribeEntry.email == email)
    if domain is not None:
        query = query.where(UnsubscribeEntry.domain == domain)
    entry = session.exec(query).first()
    return {"unsubscribed": entry is not None}
