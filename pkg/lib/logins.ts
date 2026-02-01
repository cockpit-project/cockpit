/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import * as python from "python";

// @ts-expect-error TS2307 this isn't a TS module, just a magic esbuild "text" import rule
import lastlog2_py from "./lastlog2.py";

export type LastlogEntry = {
    time: number;
    tty: string;
    host: string;
};

/* Return lastlog2 database as { username → LastLogin } object.
 * Throws an exception if the db does not exist, i.e. the system isn't using lastlog2.
*/
export async function getLastlog2(user?: string): Promise<Record<string, LastlogEntry>> {
    const out = await python.spawn(lastlog2_py, user ? [user] : [], { err: "message" });
    return JSON.parse(out);
}
