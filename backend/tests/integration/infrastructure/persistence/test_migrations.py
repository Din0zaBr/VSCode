from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def test_messaging_tables_exist(session: AsyncSession) -> None:
    result = await session.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'messaging'"
        ),
    )
    tables = {row[0] for row in result}
    assert {"outbox", "inbox"} <= tables
