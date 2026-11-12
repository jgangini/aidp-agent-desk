"""An OS-held lock prevents another process recovering a live scheduler's claims."""

import os
import sys
from pathlib import Path


class SchedulerLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.descriptor: int | None = None

    def acquire(self) -> None:
        if self.descriptor is not None:
            return
        descriptor = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            if sys.platform == "win32":
                import msvcrt

                if os.fstat(descriptor).st_size == 0:
                    os.write(descriptor, b"0")
                os.lseek(descriptor, 0, os.SEEK_SET)
                msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.descriptor = descriptor
        except OSError as error:
            os.close(descriptor)
            raise RuntimeError("Otro proceso ya administra las tareas de esta instancia.") from error

    def release(self) -> None:
        descriptor, self.descriptor = self.descriptor, None
        if descriptor is not None:
            os.close(descriptor)
