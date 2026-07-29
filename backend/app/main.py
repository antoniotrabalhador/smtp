import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import create_db_and_tables
from app.routers import agent, campaigns, email, nodes, recipient_lists, unsubscribe, webhooks

app = FastAPI(title="SMTP Fleet Panel")

_cors_env = os.getenv("CORS_ORIGINS", "http://localhost:5173")
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(nodes.router)
app.include_router(agent.router)
app.include_router(email.router)
app.include_router(campaigns.router)
app.include_router(recipient_lists.router)
app.include_router(unsubscribe.router)
app.include_router(webhooks.router)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


@app.get("/api/health")
def health():
    return {"status": "ok"}
