declare module 'qunit-tap' {
    export default function qunitTap(qunitObject: QUnit, printLikeFunction: (message: string, ...args: unknown[]) => void, options?: unknown): void;
}
