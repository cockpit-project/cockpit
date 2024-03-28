/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import cockpit from "cockpit";

const BLOCK_SIZE = 16 * 1024;
/*
 * Something smart about upload
 */
export class UploadHelper {
    constructor(file, destination, chunk_size = BLOCK_SIZE, onProgress, onDone) {
        this.file = file;
        this.destination = destination;
        this.chunk_size = chunk_size;
        this.progressCallback = onProgress;
        this.doneCallback = onDone;
        this.doneResolve = null;
    }

    // Private methods
    read_chunk(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });
    }

    on_control(event, message) {
        this.channel.removeEventListener("close", this.on_control);
        this.doneCallback();
        this.doneResolve();
    }

    wait_done() {
        const channel = this.channel;

        return new Promise((resolve, reject) => {
            channel.addEventListener("close", this.on_control.bind(this));
            this.doneResolve = resolve;
        });
    }

    // Public methods
    async upload() {
        // Open fsreplace1 channel
        this.channel = cockpit.channel({
            binary: true,
            payload: "fsreplace1",
            path: this.destination,
            superuser: "try",
            "send-acks": "frames"
        });

        const semaphore = new UploadSempaphore(this.channel);

        let chunk_start = 0;
        console.log("amount of chunks", Math.ceil(this.file.size / BLOCK_SIZE));
        while (chunk_start <= this.file.size) {
            console.time("writeChunk");
            const progress = Math.floor((chunk_start / this.file.size) * 100);
            this.progressCallback(progress);

            console.log(chunk_start, this.file.size, progress, semaphore.count);

            const chunk_next = chunk_start + BLOCK_SIZE;
            const blob = this.file.slice(chunk_start, chunk_next);
            const chunk = await this.read_chunk(blob);
            await semaphore.wait();
            this.channel.send(chunk);

            chunk_start = chunk_next;
            console.timeEnd("writeChunk");
        }

        this.channel.control({ command: "done" });
        await this.wait_done();
        this.channel.close();
    }

    cancel() {
        this.channel.close();
    }
}

class UploadSempaphore {
    constructor(channel, count = 128) {
        this.channel = channel;
        this.count = count;
        this.resolveQueue = [];
        channel.addEventListener("control", this.on_control.bind(this));
    }

    on_control(event, message) {
        if (message.command === "send-acks") {
            console.log("receive ack", this, this.resolveQueue);
            this.count += message.frames;
            console.assert(this.count <= 128, "queue size too big", this.count);
            console.assert(this.resolveQueue.length <= 1, "queue must be 1", this.resolveQueue);
            for (const resolve of this.resolveQueue) {
                console.log("Resolve LOCK");
                resolve();
            }
            this.resolveQueue = [];
        }
    }

    async wait() {
        console.assert(this.count >= 0, "ack count went negative", this.count);
        this.count -= 1;

        if (this.count > 0) {
            return Promise.resolve(true);
        } else {
            return new Promise((resolve, reject) => this.resolveQueue.push(resolve));
        }
    }

    async acquire() {
        return this.wait();
    }
}
