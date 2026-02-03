// SPDX-License-Identifier: LGPL-2.1-or-later
declare module 'qunit-tap' {
    export default function qunitTap(qunitObject: QUnit, printLikeFunction: (message: string, ...args: unknown[]) => void, options?: unknown): void;
}
