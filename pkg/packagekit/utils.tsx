export function debug(...args: unknown[]) {
    if (window.debugging == 'all' || window.debugging?.includes('packagekit'))
        console.debug('packagekit:', ...args);
}
