from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.models import User, Webhook
from core.schemas import MessageResponse, WebhookCreate, WebhookRead, WebhookUpdate
from core.security import get_current_user, require_roles

router = APIRouter()

@router.get("/", response_model=list[WebhookRead])
async def list_webhooks(
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> list[WebhookRead]:
    result = await session.execute(select(Webhook).order_by(Webhook.created_at.desc()))
    return [WebhookRead.model_validate(w) for w in result.scalars()]


@router.post("/", response_model=WebhookRead, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    payload: WebhookCreate,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> WebhookRead:
    webhook = Webhook(**payload.model_dump())
    session.add(webhook)
    await session.commit()
    await session.refresh(webhook)
    return WebhookRead.model_validate(webhook)


@router.patch("/{webhook_id}", response_model=WebhookRead)
async def update_webhook(
    webhook_id: int,
    payload: WebhookUpdate,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> WebhookRead:
    webhook = await session.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(webhook, key, value)
    
    await session.commit()
    await session.refresh(webhook)
    return WebhookRead.model_validate(webhook)


@router.delete("/{webhook_id}", response_model=MessageResponse)
async def delete_webhook(
    webhook_id: int,
    current_user: User = Depends(require_roles("admin", "super-admin")),
    session: AsyncSession = Depends(get_db),
) -> MessageResponse:
    webhook = await session.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    
    await session.delete(webhook)
    await session.commit()
    return MessageResponse(message="Webhook deleted.")
