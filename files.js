import path from 'path';

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
        "base1/test-base64",
        "base1/test-browser-storage",
        "base1/test-cache",
        "base1/test-chan",
        "base1/test-dbus-address",
        "base1/test-dbus-framed",
        "base1/test-dbus",
        "base1/test-echo",
        "base1/test-events",
        "base1/test-external",
        "base1/test-file",
        "base1/test-format",
        "base1/test-framed-cache",
        "base1/test-framed",
        "base1/test-http",
        "base1/test-journal-renderer",
        "base1/test-locale",
        "base1/test-location",
        "base1/test-metrics",
        "base1/test-no-jquery",
        "base1/test-permissions",
        "base1/test-promise",
        "base1/test-protocol",
        "base1/test-series",
        "base1/test-spawn-proc",
        "base1/test-spawn",
        "base1/test-stream",
        "base1/test-user",
        "base1/test-utf8",
        "base1/test-websocket",

        "kdump/test-config-client",

        "networkmanager/test-utils",

        "shell/machines/test-machines",

        "storaged/test-util",
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
    "Text-updated-Bold", "Text-updated-BoldItalic", "Text-updated-Italic", "Text-updated-Medium", "Text-updated-MediumItalic", "Text-updated-Regular",
    "Display-updated-Black", "Display-updated-BlackItalic", "Display-updated-Bold", "Display-updated-BoldItalic",
    "Display-updated-Italic", "Display-updated-Medium", "Display-updated-MediumItalic", "Display-updated-Regular",
    "Mono-updated-Bold", "Mono-updated-BoldItalic", "Mono-updated-Italic", "Mono-updated-Medium", "Mono-updated-MediumItalic", "Mono-updated-Regular",
].map(name => {
    const subdir = 'RedHat' + name.split('-')[0];
    const fontsdir = '@patternfly/patternfly/assets/fonts/RedHatFont-updated';

    return {
        // Rename the RedHat*-updated files to not contain the 'updated' string so as to keep compatibility with external plugins
        // which expect the non-updated font file names in `static` folder
        from: path.resolve(nodedir, fontsdir, subdir, 'RedHat' + name + '.woff2'),
        to: 'static/fonts/RedHat' + name.replace("-updated", "") + ".woff2"
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
