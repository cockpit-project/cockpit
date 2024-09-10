import path from 'node:path';
import process from 'node:process';

const info = {
    entries: [
        "base1/cockpit.js",
        "apps/apps.jsx",
        "kdump/kdump.js",
        // do *not* call this metrics/metrics -- uBlock origin etc. like to block metrics.{css,js}
        "metrics/index.js",

        "networkmanager/networkmanager.jsx",
        "networkmanager/firewall.jsx",

        "playground/index.js",
        "playground/exception.js",
        "playground/metrics.js",
        "playground/pkgs.js",
        "playground/plot.js",
        "playground/react-patterns.js",
        "playground/service.js",
        "playground/speed.js",
        "playground/test.js",
        "playground/translate.js",
        "playground/preloaded.js",
        "playground/notifications-receiver.js",
        "playground/journal.jsx",
        "playground/remote.tsx",

        "selinux/selinux.js",
        "shell/shell.js",
        "sosreport/sosreport.jsx",
        "static/login.js",
        "storaged/storaged.jsx",

        "systemd/services.jsx",
        "systemd/logs.jsx",
        "systemd/overview.jsx",
        "systemd/terminal.jsx",
        "systemd/hwinfo.jsx",

        "packagekit/updates.jsx",
        "users/users.js",
    ],

    tests: [
        "base1/test-base64.js",
        "base1/test-browser-storage.js",
        "base1/test-cache.js",
        "base1/test-chan.js",
        "base1/test-channel.ts",
        "base1/test-dbus-address.js",
        "base1/test-dbus-framed.js",
        "base1/test-dbus.js",
        "base1/test-echo.js",
        "base1/test-events.js",
        "base1/test-external.js",
        "base1/test-file.js",
        "base1/test-format.ts",
        "base1/test-framed-cache.js",
        "base1/test-framed.js",
        "base1/test-fsinfo.ts",
        "base1/test-http.js",
        "base1/test-journal-renderer.js",
        "base1/test-locale.js",
        "base1/test-location.js",
        "base1/test-metrics.js",
        "base1/test-no-jquery.js",
        "base1/test-permissions.js",
        "base1/test-promise.ts",
        "base1/test-protocol.js",
        "base1/test-series.js",
        "base1/test-spawn-proc.js",
        "base1/test-spawn.js",
        "base1/test-stream.js",
        "base1/test-timeformat.ts",
        "base1/test-types.ts",
        "base1/test-user.js",
        "base1/test-websocket.js",

        "lib/test-path.ts",

        "kdump/test-config-client.js",

        "networkmanager/test-utils.js",

        "shell/machines/test-machines.js",

        "storaged/test-util.js",
    ],

    files: [
        "apps/index.html",
        "apps/default.png",

        "kdump/index.html",

        "metrics/index.html",

        "networkmanager/index.html",
        "networkmanager/firewall.html",

        "packagekit/index.html",

        "playground/index.html",
        "playground/exception.html",
        "playground/hammer.gif",
        "playground/metrics.html",
        "playground/pkgs.html",
        "playground/plot.html",
        "playground/react-patterns.html",
        "playground/service.html",
        "playground/speed.html",
        "playground/test.html",
        "playground/translate.html",
        "playground/preloaded.html",
        "playground/notifications-receiver.html",
        "playground/journal.html",
        "playground/remote.html",

        "selinux/index.html",

        "shell/images/server-error.png",
        "shell/images/server-large.png",
        "shell/images/server-small.png",
        "shell/images/cockpit-icon.svg",
        "shell/images/bg-plain.jpg",
        "shell/index.html",
        "shell/shell.html",

        "sosreport/index.html",
        "sosreport/sosreport.png",

        "static/login.html",

        "storaged/index.html",
        "storaged/images/storage-array.png",
        "storaged/images/storage-disk.png",

        "systemd/index.html",
        "systemd/logs.html",
        "systemd/services.html",
        "systemd/terminal.html",
        "systemd/hwinfo.html",

        "users/index.html",
    ]
};

const srcdir = process.env.SRCDIR || '.';
const nodedir = path.relative(process.cwd(), path.resolve(srcdir, "node_modules"));

export const all_subdirs = Array.from(new Set(info.entries.map(key => key.split('/')[0])));

const redhat_fonts = [
    "Text-Bold", "Text-BoldItalic", "Text-Italic", "Text-Medium", "Text-MediumItalic", "Text-Regular",
    "Display-Black", "Display-BlackItalic", "Display-Bold", "Display-BoldItalic",
    "Display-Italic", "Display-Medium", "Display-MediumItalic", "Display-Regular",
    "Mono-Bold", "Mono-BoldItalic", "Mono-Italic", "Mono-Medium", "Mono-MediumItalic", "Mono-Regular",
].map(name => {
    const subdir = 'RedHat' + name.split('-')[0];
    const fontsdir = '@patternfly/patternfly/assets/fonts';

    return {
        from: path.resolve(nodedir, fontsdir, subdir, 'RedHat' + name + '.woff2'),
        to: 'static/fonts/'
    };
});

const pkgfile = suffix => `${srcdir}/pkg/${suffix}`;
export const getFiles = subdir => {
    /* Qualify all the paths in entries */
    const entryPoints = [];
    info.entries.forEach(key => {
        if (subdir && key.indexOf(subdir) !== 0)
            return;

        entryPoints.push(pkgfile(key));
    });

    /* Qualify all the paths in files listed */
    const files = [];
    info.files.forEach(value => {
        if (!subdir || value.indexOf(subdir) === 0)
            files.push({ from: pkgfile(value), to: path.dirname(value) });
    });
    if (subdir) {
        const manifest = subdir + "/manifest.json";
        files.push({ from: pkgfile(manifest), to: subdir });
    } else {
        all_subdirs.forEach(subdir => {
            const manifest = subdir + "/manifest.json";
            files.push({ from: pkgfile(manifest), to: subdir });
        });
    }

    return ({ entryPoints, assetFiles: files, redhat_fonts });
};

export const getTestFiles = () => info.tests;
