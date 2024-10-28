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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import type cockpit from "cockpit";
import * as python from "python";

// @ts-expect-error TS2307 this isn't a TS module, just a magic esbuild "text" import rule
import lastlog2_py from "./lastlog2.py";

/* Return lastlog2 database as { username → { time, tty, host } } object.
 * Throws an exception if the db does not exist, i.e. the system isn't using lastlog2.
*/
export async function getLastlog2(user?: string): Promise<cockpit.JsonObject> {
    const out = await python.spawn(lastlog2_py, user ? [user] : [], { err: "message" });
    return JSON.parse(out);
}
