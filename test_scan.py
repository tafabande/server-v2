import asyncio
from core.database import AsyncSessionLocal
from core.media import scan_media_library

async def main():
    async with AsyncSessionLocal() as session:
        try:
            total = await scan_media_library(session)
            print(f"Success! Indexed {total} items.")
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
