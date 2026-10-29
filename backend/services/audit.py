from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from models.audit_log import AuditLog
from models.user import User


async def record(db: AsyncSession, user: User | None, action: str, resource: str, detail: dict | None = None, request: Request | None = None) -> None:
    db.add(AuditLog(
        actor_id=str(user.id) if user else None,
        actor_role=user.role.value if user else None,
        action=action,
        resource=resource,
        detail=detail or {},
        ip=request.client.host if request and request.client else None,
    ))
