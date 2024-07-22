# This file is part of Cockpit.
#
# Copyright (C) 2024 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import contextlib
import queue
import threading
from types import TracebackType
from typing import Awaitable, ClassVar, Generic, NamedTuple, Self, TypeVar, override

from cockpit._vendor import systemd_ctypes

T = TypeVar('T')


class AsyncJob:
    async def run(self) -> None:
        raise NotImplementedError


class AsyncThread(threading.Thread):
    default: ClassVar[Self | None] = None

    def __init__(self):
        super().__init__(daemon=True)
        self.job_queue = queue.Queue[AsyncJob]()

    async def main(self) -> None:
        while True:
            job = self.job_queue.get()
            await job.run()

    @override
    def run(self):
        systemd_ctypes.run_async(self.main())

    @classmethod
    def get_default(cls) -> Self:
        if cls.default is None:
            cls.default = cls()
            cls.default.start()
        return cls.default

    def submit(self, job: AsyncJob) -> None:
        self.job_queue.put(job)


class ReturnValueResult(NamedTuple, Generic[T]):
    value: T


class ExceptionResult(NamedTuple):
    exc: BaseException


class AwaitableJob(AsyncJob, Generic[T]):
    def __init__(self, awaitable: Awaitable[T]):
        self.reply_queue = queue.Queue[ReturnValueResult[T] | ExceptionResult]()
        self.awaitable = awaitable

    async def run(self) -> None:
        try:
            self.reply_queue.put(ReturnValueResult(await self.awaitable))
        except BaseException as exc:
            self.reply_queue.put(ExceptionResult(exc))

    def wait(self) -> T:
        result = self.reply_queue.get()
        if isinstance(result, ReturnValueResult):
            return result.value
        else:
            raise result.exc

    @classmethod
    def execute(cls, awaitable: Awaitable[T], thread: AsyncThread | None = None) -> T:
        task = AwaitableJob(awaitable)
        (thread or AsyncThread.get_default()).submit(task)
        return task.wait()


class SyncContextManager(contextlib.AbstractContextManager[T]):
    def __init__(self, cm: contextlib.AbstractAsyncContextManager[T], thread: AsyncThread | None = None):
        self.thread = thread
        self.cm = cm

    @override
    def __enter__(self) -> T:
        return AwaitableJob.execute(self.cm.__aenter__())

    @override
    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> bool | None:
        return AwaitableJob.execute(self.cm.__aexit__(exc_type, exc, tb))
