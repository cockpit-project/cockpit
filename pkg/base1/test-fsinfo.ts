import QUnit, { f } from "qunit-tests";

import cockpit from "cockpit";
import { FsInfoClient, FsInfoState, fsinfo } from "cockpit/fsinfo";

function fsinfo_err(errno: "ENOENT" | "EPERM" | "EACCES" | "ENOTDIR" | "ELOOP") {
    const problems = {
        ENOENT: 'not-found',
        EPERM: 'access-denied',
        EACCES: 'access-denied',
        ENOTDIR: 'not-directory',
        ELOOP: 'internal-error',
    };
    const strerr = {
        ENOENT: 'No such file or directory',
        EPERM: 'Access denied',
        EACCES: 'Permission denied',
        ENOTDIR: 'Not a directory',
        ELOOP: 'Too many levels of symbolic links',
    };

    return { error: { errno, problem: problems[errno], message: strerr[errno] } };
}

QUnit.test("fsinfo trivial", async assert => {
    // Make sure that it's not an error to open with no attributes requested
    assert.deepEqual(await fsinfo("/", []), {}, "Yup, '/' is still there.");
});

QUnit.test("fsinfo errors", async assert => {
    assert.timeout(5000);

    // Just test that errors are reported correctly in general.  The unit test
    // is more explicit about the specific error conditions that need to be
    // checked for.
    let thrown: string = '';
    try {
        await fsinfo("rel", []);
        assert.ok(false, "fsinfo() error checking");
    } catch (exc: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        thrown = exc.problem;
    }
    assert.equal(thrown, 'protocol-error', "fsinfo() error checking");
});

QUnit.test("FsInfoClient errors", async assert => {
    const client = new FsInfoClient("rel", []);
    try {
        // We want to get 'close' with a problem code, and no 'change'
        const expected = await new Promise((resolve, reject) => {
            client.on('close', (msg) => resolve(msg.problem));
            client.on('change', reject);
        });
        assert.equal(expected, 'protocol-error', "FsInfoClient error checking");
    } finally {
        // Calling .close() after we got 'close' event is still OK.
        client.close();
    }
});

QUnit.test("fsinfo cases", async assert => {
    assert.timeout(5000);

    const dir = await cockpit.spawn([
        'sh', '-c',
        `
           cd "$(mktemp -d)"
           echo -n "$(pwd)"

           # a normal directory
           mkdir dir
           echo dir file > dir/dir-file.txt
           echo do not read this > dir-file.xtx

           # a directory without +x (search)
           mkdir no-x-dir
           echo file > no-x-dir/no-x-dir-file.txt
           chmod 644 no-x-dir

           # a directory without +r (read)
           mkdir no-r-dir
           echo file > no-r-dir/no-r-dir-file.txt
           chmod 311 no-r-dir

           # a normal file
           echo normal file > file

           # a non-readable file
           echo inaccessible file > no-r-file
           chmod 0 no-r-file

           # a device
           ln -sf /dev/null dev

           # a dangling symlink
           ln -sf does-not-exist dangling

           # a symlink pointing to itself
           ln -sf loopy loopy
        `
    ]);

    const cases: Record<string, FsInfoState> = {
        dir: { info: { type: 'dir', entries: { 'dir-file.txt': { type: 'reg' } } } },

        // can't stat() the file
        'no-x-dir': { info: { type: "dir", entries: { "no-x-dir-file.txt": {} } } },

        // can't read the directory, so no entries
        'no-r-dir': { info: { type: "dir" } },

        // normal file, can read its contents
        file: { info: { type: "reg" } },

        // can't read file, so no contents
        'no-r-file': { info: { type: "reg" } },

        // a device
        dev: { info: { type: "chr" } },

        // a dangling symlink
        dangling: fsinfo_err('ENOENT'),

        // a link pointing at itself
        loopy: fsinfo_err('ELOOP'),
    } as const;

    try {
        // Check the async one-shot non-watching API first
        for (const [name, expected_state] of Object.entries(cases)) {
            try {
                const state = await fsinfo(`${dir}/${name}`, ['type', 'entries']);
                assert.deepEqual(state, expected_state.info, f`fsinfo(${name})`);
            } catch (exc) {
                assert.deepEqual(exc, expected_state.error, f`fsinfo(${name})`);
            }
        }

        // Now test the client (watcher)
        for (let [name, expected_state] of Object.entries(cases)) {
            const client = new FsInfoClient(`${dir}/${name}`, ['type', 'entries']);

            // Watching requires read access to the directory
            if (name.includes('no-r')) {
                expected_state = fsinfo_err('EACCES');
            }

            // await the first state change: it's guaranteed to be the complete data
            const value = await new Promise<FsInfoState>(resolve => { client.on('change', resolve) });
            assert.deepEqual(value, expected_state, f`FsInfoClient(${name})`);

            client.close();
        }
    } finally {
        await cockpit.spawn(["chmod", "-R", "u+rwX", dir]);
        await cockpit.spawn(["rm", "-rf", dir]);
    }
});

QUnit.start();
