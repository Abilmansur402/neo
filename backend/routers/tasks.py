"""Portal 1 · doctor shift task list ("redline tracker"). AI-generated tasks are created when a prediction is High/Critical."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.clinical import ClinicalTask
from models.user import User, UserRole
from services import audit
from services.security import require_roles

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
DOCTORS = require_roles(UserRole.neonatologist, UserRole.admin)


class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    patient_id: str | None = None
    priority: str = Field(default="normal", pattern="^(low|normal|high|critical)$")
    due_in_minutes: int | None = Field(default=None, ge=1, le=7 * 24 * 60)


class TaskOut(BaseModel):
    id: UUID
    title: str
    patient_id: str | None
    priority: str
    due_at: datetime | None
    done: bool
    source: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[TaskOut])
async def list_tasks(include_done: bool = False, db: AsyncSession = Depends(get_db), user: User = Depends(DOCTORS)):
    q = select(ClinicalTask).where(ClinicalTask.hospital_id == user.hospital_id)
    if not include_done:
        q = q.where(ClinicalTask.done.is_(False))
    return (await db.execute(q.order_by(ClinicalTask.done, ClinicalTask.due_at.nulls_last(), ClinicalTask.created_at.desc()))).scalars().all()


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(body: TaskIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(DOCTORS)):
    t = ClinicalTask(hospital_id=user.hospital_id, patient_id=body.patient_id, title=body.title, priority=body.priority, created_by=user.id,
                     due_at=datetime.now(timezone.utc) + timedelta(minutes=body.due_in_minutes) if body.due_in_minutes else None)
    db.add(t)
    await audit.record(db, user, "task.create", "tasks", {"title": body.title}, request)
    await db.commit()
    await db.refresh(t)
    return t


@router.patch("/{task_id}", response_model=TaskOut)
async def toggle_task(task_id: UUID, done: bool = True, db: AsyncSession = Depends(get_db), user: User = Depends(DOCTORS)):
    t = await db.get(ClinicalTask, task_id)
    if not t or t.hospital_id != user.hospital_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    t.done = done
    await db.commit()
    await db.refresh(t)
    return t


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(DOCTORS)):
    t = await db.get(ClinicalTask, task_id)
    if t and t.hospital_id == user.hospital_id:
        await db.delete(t)
        await db.commit()
