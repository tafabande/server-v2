import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime
from pathlib import Path
import uuid

import httpx
from sqlalchemy import select

from core.database import AsyncSessionLocal
from core.logging import get_logger
from core.models import Webhook

logger = get_logger("webhooks")

async def trigger_webhook(event: str, data: dict):
    """
    Triggers all active webhooks subscribed to the given event.
    Runs as a non-blocking background task.
    """
    asyncio.create_task(_process_webhooks(event, data))

async def _process_webhooks(event: str, data: dict):
    # Ensure data is JSON serializable (handling datetimes, etc.)
    def default_serializer(obj):
        if isinstance(obj, (datetime, Path)):
            return str(obj)
        raise TypeError(f"Type {type(obj)} not serializable")

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Webhook).where(Webhook.is_active == True)
        )
        webhooks = result.scalars().all()

    targets = [w for w in webhooks if w.events == "*" or event in (w.events or "").split(",")]
    if not targets:
        return

    # To ensure idempotency at the receiver, generate a unique event UUID.
    # The receiver can use this event ID to deduplicate identical events.
    event_id = str(uuid.uuid4())
    payload = {
        "id": event_id,
        "event_id": event_id,
        "event": event,
        "timestamp": datetime.now(UTC).isoformat(),
        "data": data
    }
    try:
        payload_str = json.dumps(payload, default=default_serializer)
    except Exception as e:
        logger.error(f"Failed to serialize webhook payload: {e}")
        return

    async with httpx.AsyncClient(timeout=5.0) as client:
        results = await asyncio.gather(*[_send_with_retry(client, w, payload_str, event_id, event) for w in targets])
        
    # Batch update results
    async with AsyncSessionLocal() as session:
        for hook_id, success, status_code in results:
            db_hook = await session.get(Webhook, hook_id)
            if not db_hook: continue
            
            if success:
                db_hook.last_triggered_at = datetime.now(UTC)
                db_hook.failure_count = 0
            else:
                db_hook.failure_count += 1
                if db_hook.failure_count > 10:
                    db_hook.is_active = False
                    logger.critical(f"Webhook {db_hook.url} auto-disabled after 10 failures.")
                else:
                    logger.warning(f"Webhook {db_hook.url} failed (status: {status_code})")
        await session.commit()

async def _send_with_retry(
    client: httpx.AsyncClient, 
    webhook: Webhook, 
    payload_str: str, 
    event_id: str, 
    event: str
) -> tuple[int, bool, int]:
    max_retries = 3
    backoff_factor = 2.0  # seconds
    status_code = 0
    
    for attempt in range(max_retries + 1):
        delivery_id = str(uuid.uuid4())
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "MediaHub-Webhook/1.0",
            "X-MediaHub-Event": event,
            "X-MediaHub-Event-Id": event_id,
            "X-MediaHub-Delivery-Id": delivery_id
        }
        if webhook.secret:
            signature = hmac.new(webhook.secret.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
            headers["X-MediaHub-Signature"] = signature

        try:
            if attempt > 0:
                logger.info(f"Retrying webhook delivery to {webhook.url} (Attempt {attempt + 1}/{max_retries + 1})")
            
            response = await client.post(webhook.url, content=payload_str, headers=headers)
            status_code = response.status_code
            if response.is_success:
                return webhook.id, True, status_code
            
            logger.warning(f"Webhook to {webhook.url} returned status {status_code} on attempt {attempt + 1}")
        except Exception as e:
            logger.error(f"Network error sending webhook to {webhook.url} on attempt {attempt + 1}: {e}")
            status_code = 0

        # If we failed and have attempts remaining, wait and try again
        if attempt < max_retries:
            sleep_time = backoff_factor * (2 ** attempt)
            await asyncio.sleep(sleep_time)

    return webhook.id, False, status_code

