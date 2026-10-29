import asyncio

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.user import User, UserRole
from services import audit
from services.fhir_connector import connector
from services.security import get_current_user, get_ws_user, require_roles

router = APIRouter(prefix="/api/integration", tags=["integration"])

BENCHMARKS = {
    "pic": {"id": "pic", "name": "PIC Database (China, baseline)", "n": 13449, "auroc": 0.912, "auprc": 0.63, "brier": 0.071, "ece": 0.021, "prevalence": 9.4, "period": "2010–2018",
            "sites": [{"site": "PIC", "auroc": 0.912}], "calibration": [{"bin": b, "observed": b + d} for b, d in zip(range(5, 100, 10), [0.5, -1, 1, -1.5, 2, -1, 1.5, -2, 1, -0.5])]},
    "kz": {"id": "kz", "name": "Kazakhstan retrospective (3 sites)", "n": 2184, "auroc": 0.871, "auprc": 0.54, "brier": 0.089, "ece": 0.048, "prevalence": 11.2, "period": "2023–2025",
           "sites": [{"site": "Astana NRC", "auroc": 0.884}, {"site": "Almaty PC1", "auroc": 0.869}, {"site": "Shymkent RPC", "auroc": 0.851}],
           "calibration": [{"bin": b, "observed": b + d} for b, d in zip(range(5, 100, 10), [2, 4, 5, 6, 7, 5, 4, 6, 3, 2])]},
}


class MappingBody(BaseModel):
    mapping: dict[str, str]


def _state_payload(hospital_id: str) -> dict:
    st = connector.state(hospital_id)
    return {"connected": st.connected, "token_preview": (st.token[:12] + "…") if st.token else None, "token_expires_in": int(max(st.token_expires - __import__("time").time(), 0)) if st.token else 0,
            "endpoints": st.endpoint_status(), "log_tail": st.log[-20:]}


@router.get("/benchmarks")
async def benchmarks(user: User = Depends(get_current_user)):
    return BENCHMARKS


@router.get("/schema")
async def schema(user: User = Depends(get_current_user)):
    return connector.schema_template()


@router.post("/schema/validate")
async def validate(body: MappingBody, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.researcher, UserRole.admin, UserRole.neonatologist))):
    result = connector.validate_mapping(body.mapping)
    await audit.record(db, user, "schema.validate", f"hospital:{user.hospital_id}", {"coverage": result["coverage"]}, request)
    await db.commit()
    return result


@router.get("/his/status")
async def his_status(user: User = Depends(get_current_user)):
    return _state_payload(user.hospital_id)


@router.post("/his/connect")
async def his_connect(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.admin, UserRole.researcher, UserRole.neonatologist))):
    await connector.connect(user.hospital_id)
    await audit.record(db, user, "his.connect", f"hospital:{user.hospital_id}", request=request)
    await db.commit()
    return _state_payload(user.hospital_id)


@router.post("/his/disconnect")
async def his_disconnect(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await connector.disconnect(user.hospital_id)
    await audit.record(db, user, "his.disconnect", f"hospital:{user.hospital_id}", request=request)
    await db.commit()
    return _state_payload(user.hospital_id)


@router.websocket("/ws/his")
async def his_ws(websocket: WebSocket):
    """Live gateway log + endpoint status. Auth: ?token=<jwt>."""
    user = await get_ws_user(websocket)
    if not user:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        async for entry in connector.stream(user.hospital_id):
            await websocket.send_json({"type": "log", "entry": entry, "endpoints": connector.state(user.hospital_id).endpoint_status()})
    except (WebSocketDisconnect, asyncio.CancelledError):
        return
