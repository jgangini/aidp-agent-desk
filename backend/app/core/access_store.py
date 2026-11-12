"""Single-instance application permissions; Oracle remains the identity authority."""

import hashlib
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class AccessStore:
    def __init__(self, path: Path, issuer: str, administrator: str) -> None:
        self.path, self.issuer = path, issuer
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with self.connect() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise RuntimeError("Unsupported access database version")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
                    email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('admin','member')),
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
                    UNIQUE(issuer,subject)
                );
                CREATE TABLE IF NOT EXISTS grants (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    profile_id TEXT NOT NULL CHECK(length(profile_id)=32),
                    PRIMARY KEY(user_id,profile_id)
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
                CREATE TABLE IF NOT EXISTS requests (
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    profile_id TEXT NOT NULL, client_session TEXT NOT NULL, client_request TEXT NOT NULL,
                    native_request TEXT NOT NULL UNIQUE,
                    PRIMARY KEY(user_id,profile_id,client_session,client_request)
                );
                PRAGMA user_version=1;
            """)
            db.execute(
                "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin' "
                "AND (issuer<>? OR subject<>?))",
                (issuer, administrator),
            )
            db.execute(
                "UPDATE users SET role='member',enabled=0 WHERE role='admin' AND (issuer<>? OR subject<>?)",
                (issuer, administrator),
            )
            db.execute(
                "INSERT INTO users(id,issuer,subject,role) VALUES(?,?,?,'admin') "
                "ON CONFLICT(issuer,subject) DO UPDATE SET role='admin',enabled=1",
                (secrets.token_hex(16), issuer, administrator),
            )
        path.chmod(0o600)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def users(self) -> list[dict[str, Any]]:
        with self.connect() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT id,subject,email,role,enabled FROM users WHERE issuer=? ORDER BY email,subject",
                    (self.issuer,),
                )
            ]

    def permitted(self, user: dict[str, Any], profile: str) -> bool:
        if user["role"] == "admin":
            return True
        with self.connect() as db:
            return (
                db.execute(
                    "SELECT 1 FROM grants WHERE user_id=? AND profile_id=?", (user["id"], profile)
                ).fetchone()
                is not None
            )

    def save_user(self, subject: str, email: str, enabled: bool, profiles: list[str]) -> None:
        with self.connect() as db:
            db.execute(
                "INSERT INTO users(id,issuer,subject,email,role,enabled) VALUES(?,?,?,?,'member',?) "
                "ON CONFLICT(issuer,subject) DO UPDATE SET email=excluded.email,enabled=excluded.enabled "
                "WHERE users.role='member'",
                (secrets.token_hex(16), self.issuer, subject, email, int(enabled)),
            )
            user = db.execute(
                "SELECT * FROM users WHERE issuer=? AND subject=?", (self.issuer, subject)
            ).fetchone()
            if user["role"] == "admin":
                raise ValueError("El administrador inicial se configura en el servidor.")
            db.execute("DELETE FROM grants WHERE user_id=?", (user["id"],))
            db.executemany(
                "INSERT INTO grants(user_id,profile_id) VALUES(?,?)",
                [(user["id"], profile) for profile in sorted(set(profiles))],
            )
            db.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))

    def login(self, subject: str, email: str) -> str | None:
        with self.connect() as db:
            user = db.execute(
                "SELECT id FROM users WHERE issuer=? AND subject=? AND enabled=1", (self.issuer, subject)
            ).fetchone()
            if user is None:
                return None
            token = secrets.token_urlsafe(32)
            db.execute("DELETE FROM sessions WHERE expires<=?", (int(time.time()),))
            db.execute("UPDATE users SET email=? WHERE id=?", (email, user["id"]))
            db.execute(
                "INSERT INTO sessions VALUES(?,?,?)",
                (self.digest(token), user["id"], int(time.time()) + 28800),
            )
            return token

    @staticmethod
    def digest(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def user(self, token: str) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute(
                "SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id "
                "WHERE s.digest=? AND s.expires>? AND u.enabled=1 AND u.issuer=?",
                (self.digest(token), int(time.time()), self.issuer),
            ).fetchone()
            return dict(row) if row else None

    def logout(self, token: str) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE digest=?", (self.digest(token),))

    def request_ids(
        self, user_id: str, profile: str, session: str, request: str, create: bool
    ) -> tuple[str, dict[str, str]]:
        with self.connect() as db:
            if create:
                db.execute(
                    "INSERT OR IGNORE INTO requests VALUES(?,?,?,?,?)",
                    (user_id, profile, session, request, secrets.token_hex(16)),
                )
            rows = db.execute(
                "SELECT client_request,native_request FROM requests "
                "WHERE user_id=? AND profile_id=? AND client_session=?",
                (user_id, profile, session),
            ).fetchall()
            mapping = {row["native_request"]: row["client_request"] for row in rows}
            native = next((key for key, value in mapping.items() if value == request), None)
            if native is None:
                raise ValueError("No existe esa solicitud para tu usuario y conversación.")
            return native, mapping
