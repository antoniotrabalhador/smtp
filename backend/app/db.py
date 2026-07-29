import os

from sqlalchemy import text
from sqlmodel import SQLModel, Session, create_engine

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./panel.db")
ENGINE_KWARGS = {"connect_args": {"check_same_thread": False}} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, **ENGINE_KWARGS)

NEW_NODE_COLUMNS = {
    "domain": "TEXT",
    "email_from": "TEXT",
    "dkim_selector": "TEXT",
    "dkim_dns_record": "TEXT",
    "dmarc_dns_record": "TEXT",
    "bootstrap_status": "TEXT",
    "bootstrap_log": "TEXT",
    "agent_token": "TEXT",
    "agent_status": "TEXT",
    "agent_last_seen": "TEXT",
    "agent_panel_url": "TEXT",
    "cloudflare_domain_id": "INTEGER",
}

NEW_TASK_COLUMNS = {
    "campaign_id": "INTEGER",
    "shard_id": "INTEGER",
    "is_test": "BOOLEAN DEFAULT 0",
    "html": "TEXT",
    "plain_text": "TEXT",
    "unsubscribe_url": "TEXT",
    "feedback_id": "TEXT",
    "cta_url": "TEXT",
}

NEW_CAMPAIGN_COLUMNS = {
    "is_draft": "BOOLEAN DEFAULT 0",
    "parent_campaign_id": "INTEGER",
    "list_id": "INTEGER",
    "chunk_size": "INTEGER DEFAULT 2000",
    "status": "TEXT DEFAULT 'draft'",
    "started_at": "TEXT",
}


def _migrate_node_columns():
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(node)"))}
        for column, col_type in NEW_NODE_COLUMNS.items():
            if column not in existing:
                conn.execute(text(f"ALTER TABLE node ADD COLUMN {column} {col_type}"))
        conn.commit()


def _migrate_task_columns():
    with engine.connect() as conn:
        try:
            existing = {row[1] for row in conn.execute(text("PRAGMA table_info(task)"))}
            for column, col_type in NEW_TASK_COLUMNS.items():
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE task ADD COLUMN {column} {col_type}"))
            conn.commit()
        except Exception:
            pass  # table may not exist yet


def _migrate_campaign_columns():
    with engine.connect() as conn:
        try:
            existing = {row[1] for row in conn.execute(text("PRAGMA table_info(campaign)"))}
            for column, col_type in NEW_CAMPAIGN_COLUMNS.items():
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE campaign ADD COLUMN {column} {col_type}"))
            conn.commit()
        except Exception:
            pass


NEW_WEBHOOK_COLUMNS = {
    "status": "TEXT DEFAULT 'pending_config'",
    "sample_payload": "TEXT",
    "list_id": "INTEGER",
    "email_field": "TEXT",
}


def _migrate_webhook_columns():
    with engine.connect() as conn:
        try:
            existing = {row[1] for row in conn.execute(text("PRAGMA table_info(webhookendpoint)"))}
            for column, col_type in NEW_WEBHOOK_COLUMNS.items():
                if column not in existing:
                    conn.execute(text(f"ALTER TABLE webhookendpoint ADD COLUMN {column} {col_type}"))
            conn.commit()
        except Exception:
            pass


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _migrate_node_columns()
    _migrate_task_columns()
    _migrate_campaign_columns()
    _migrate_webhook_columns()


def get_session():
    with Session(engine) as session:
        yield session
