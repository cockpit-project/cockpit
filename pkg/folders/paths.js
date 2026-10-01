/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

export function joinPath(base, name) {
    if (base === '/')
        return `/${name}`;
    return `${base}/${name}`;
}

export function fileName(path) {
    const trimmed = String(path).replace(/\/+$/, '') || '/';
    if (trimmed === '/')
        return '/';
    const slash = trimmed.lastIndexOf('/');
    return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

export function extension(path) {
    const base = fileName(path);
    const dot = base.lastIndexOf('.');
    if (dot <= 0)
        return '';
    return base.slice(dot + 1).toLowerCase();
}

export function formatMode(mode) {
    if (mode === undefined)
        return '—';
    return (mode & 0o7777).toString(8).padStart(4, '0');
}

export function formatOwner(entry) {
    const user = entry.user ?? '?';
    const group = entry.group ?? '?';
    return `${user}:${group}`;
}

export function pathSegments(dir) {
    const parts = String(dir).split('/').filter(p => p !== '');
    const out = [{ name: '/', path: '/' }];
    let acc = '';
    for (const part of parts) {
        acc += `/${part}`;
        out.push({ name: part, path: acc });
    }
    return out;
}

/* Turn a path-bar value into an absolute path. '~' / '~/…' expand against home.
 * Relative paths are rejected; the caller shows the error. */
export function resolveUserPath(input, home) {
    let target = String(input ?? '').trim();
    if (!target)
        return { empty: true };
    if (target === '~')
        target = home;
    else if (target.startsWith('~/'))
        target = joinPath(home, target.slice(2));
    if (!target.startsWith('/'))
        return { error: 'relative' };
    target = target.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
    return { path: target };
}
