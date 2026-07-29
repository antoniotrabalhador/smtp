import email
import re
from datetime import datetime
from email import policy
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import EmailTemplate, EmailTemplateCreate, EmailTemplateRead

router = APIRouter(prefix="/api/email", tags=["email"])


class ParsedEmail(BaseModel):
    html: str
    text: str
    subject: str
    headers: dict


def html_to_text(html: str) -> str:
    """Simple HTML to text conversion."""
    # Remove script and style
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
    # Remove tags
    text = re.sub(r"<[^>]+>", "\n", text)
    # Decode entities
    text = text.replace("&nbsp;", " ").replace("&quot;", '"').replace("&apos;", "'")
    text = text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    # Clean up whitespace
    text = re.sub(r"\n\s*\n", "\n", text)
    return text.strip()


@router.post("/parse-eml", response_model=ParsedEmail)
async def parse_eml(eml_content: UploadFile = File(...)):
    """Parse EML file and extract HTML, text, subject and headers."""
    try:
        # Read file content
        content = await eml_content.read()
        if isinstance(content, bytes):
            content = content.decode("utf-8", errors="ignore")

        # Parse email
        msg = email.message_from_string(content, policy=policy.default)

        # Extract subject
        subject = msg.get("subject", "Sem assunto")

        # Extract HTML body
        html_body = ""
        text_body = ""

        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()

                if content_type == "text/html":
                    html_body = part.get_payload(decode=True).decode("utf-8", errors="ignore")
                elif content_type == "text/plain" and not text_body:
                    text_body = part.get_payload(decode=True).decode("utf-8", errors="ignore")
        else:
            content_type = msg.get_content_type()
            if content_type == "text/html":
                html_body = msg.get_payload(decode=True).decode("utf-8", errors="ignore")
            else:
                text_body = msg.get_payload(decode=True).decode("utf-8", errors="ignore")

        # If no text body, generate from HTML
        if not text_body and html_body:
            text_body = html_to_text(html_body)

        # Extract relevant headers
        headers = {
            "from": msg.get("from", ""),
            "to": msg.get("to", ""),
            "cc": msg.get("cc", ""),
            "reply_to": msg.get("reply-to", ""),
            "content_type": msg.get("content-type", ""),
            "list_unsubscribe": msg.get("list-unsubscribe", ""),
        }

        return ParsedEmail(
            html=html_body or "<p>Sem conteúdo HTML</p>",
            text=text_body or "Sem conteúdo texto",
            subject=subject,
            headers={k: v for k, v in headers.items() if v},
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao parsear EML: {str(e)}")


# ── Templates CRUD ────────────────────────────────────────────────────────────

@router.get("/templates", response_model=List[EmailTemplateRead])
def list_templates(session: Session = Depends(get_session)):
    return session.exec(select(EmailTemplate).order_by(EmailTemplate.updated_at.desc())).all()


@router.post("/templates", response_model=EmailTemplateRead)
def create_template(payload: EmailTemplateCreate, session: Session = Depends(get_session)):
    tpl = EmailTemplate(**payload.model_dump())
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    return tpl


@router.put("/templates/{tpl_id}", response_model=EmailTemplateRead)
def update_template(tpl_id: int, payload: EmailTemplateCreate, session: Session = Depends(get_session)):
    tpl = session.get(EmailTemplate, tpl_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    for k, v in payload.model_dump().items():
        setattr(tpl, k, v)
    tpl.updated_at = datetime.utcnow()
    session.add(tpl)
    session.commit()
    session.refresh(tpl)
    return tpl


@router.delete("/templates/{tpl_id}")
def delete_template(tpl_id: int, session: Session = Depends(get_session)):
    tpl = session.get(EmailTemplate, tpl_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    session.delete(tpl)
    session.commit()
    return {"ok": True}
