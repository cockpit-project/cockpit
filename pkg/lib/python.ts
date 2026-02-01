/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit, { BasicError } from "cockpit";

const pyinvoke = ["sh", "-ec", "exec $(command -v /usr/libexec/platform-python || command -v python3) -c \"$@\"", "--"];

export interface PythonExitStatus extends BasicError {
    exit_status: number | null,
    exit_signal: number | null,
}

// only declare the string variant for the time being; we don't use the binary variant
export function spawn (
    script_pieces: string | string[],
    args?: string[],
    options?: cockpit.SpawnOptions & { binary?: false; }
): cockpit.Spawn<string> {
    const script = (typeof script_pieces == "string")
        ? script_pieces
        : script_pieces.join("\n");

    return cockpit.spawn(pyinvoke.concat([script]).concat(args ?? []), options);
}
