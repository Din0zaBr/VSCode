from agent.src.readers.base import LogReader
from agent.src.readers.file_reader import FileReader
from agent.src.readers.journald_reader import JournaldReader

# WinEventReader is only available on Windows (requires pywin32)
try:
    from agent.src.readers.winevent_reader import WinEventReader
    __all__ = ["LogReader", "FileReader", "JournaldReader", "WinEventReader"]
except (ImportError, RuntimeError):
    WinEventReader = None  # type: ignore[assignment,misc]
    __all__ = ["LogReader", "FileReader", "JournaldReader"]
