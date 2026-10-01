import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAptConflictPackages } from '../../pkg/packagekit/apt-conflicts.js';
import {
    extension, fileName, formatMode, formatOwner, joinPath, pathSegments, resolveUserPath
} from '../../pkg/folders/paths.js';

test('parseAptConflictPackages: Raspberry Pi pcmanfm error', () => {
    assert.deepEqual(
        parseAptConflictPackages([
            'The following packages have unmet dependencies:\n  pcmanfm-pi: Breaks: pcmanfm but 1.4.0-1+rpt9 is to be installed'
        ]),
        ['pcmanfm-pi']);
});

test('parseAptConflictPackages: unique Breaks/Replaces/Conflicts', () => {
    const text = 'foo-new: Replaces: foo-old\nbar: Conflicts: bar-legacy\nfoo-new: Breaks: foo-old';
    assert.deepEqual(parseAptConflictPackages([text]).sort(), ['bar', 'foo-new']);
});

test('parseAptConflictPackages: error objects and noise', () => {
    assert.deepEqual(parseAptConflictPackages([{ detail: 'libfoo2: Breaks: libfoo1' }]), ['libfoo2']);
    assert.deepEqual(parseAptConflictPackages(['Applying updates failed']), []);
});

test('folders joinPath and fileName', () => {
    assert.equal(joinPath('/', 'home'), '/home');
    assert.equal(joinPath('/home/admin', 'docs'), '/home/admin/docs');
    assert.equal(fileName('/home/admin/readme.txt'), 'readme.txt');
});

test('folders extension, mode, owner', () => {
    assert.equal(extension('/a/photo.PNG'), 'png');
    assert.equal(extension('/a/.bashrc'), '');
    assert.equal(formatMode(0o100755), '0755');
    assert.equal(formatOwner({}), '?:?');
});

test('folders pathSegments and resolveUserPath', () => {
    assert.deepEqual(pathSegments('/home/admin').map(s => s.path), ['/', '/home', '/home/admin']);
    assert.deepEqual(resolveUserPath('~/docs', '/home/admin'), { path: '/home/admin/docs' });
    assert.deepEqual(resolveUserPath('relative', '/home/admin'), { error: 'relative' });
});
