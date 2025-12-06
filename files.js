import fs from 'node:fs';
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
        "playground/terminal.tsx",
        "playground/packagemanager.tsx",

        "selinux/selinux.js",
        "shell/shell.jsx",
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
        "base1/test-file.ts",
        "base1/test-format.ts",
        "base1/test-framed-cache.js",
        "base1/test-framed.js",
        "base1/test-fsinfo.ts",
        "base1/test-http.js",
        "base1/test-info.ts",
        "base1/test-journal-renderer.js",
        "base1/test-locale.js",
        "base1/test-location.js",
        "base1/test-metrics.js",
        "base1/test-path.ts",
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
        "base1/test-import-json.ts",

        "kdump/test-config-client.js",

        "networkmanager/test-utils.js",
        "networkmanager/test-wifi-hooks.js",

        "shell/machines/test-machines.js",

        "storaged/test-util.js",
    ],

    // esbuild will already copy assets that are explicitly imported from JavaScript.
    // The others (top-level files, images, etc.) need to be listed explicitly
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
        "playground/terminal.html",
        "playground/packagemanager.html",

        "selinux/index.html",

        "shell/images/server-error.png",
        "shell/images/server-large.png",
        "shell/images/server-small.png",
        "shell/images/cockpit-icon.svg",
        "shell/images/cockpit-icon-gray.svg",
        "shell/images/bg-plain.jpg",
        "shell/index.html",
        "shell/shell.html",

        "sosreport/index.html",
        "sosreport/sosreport.png",

        "static/login.html",

        "storaged/index.html",

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

// This are the fonts we used up until migrating to Patternfly v6
// It is kept here to make sure all dependencies of the fonts works like in
// third-party plugins etc.

// With the PF6 migration we now want to use Variable Fonts (VF) to ensure better
// Patternfly visuals, and we will use a new directory structure to avoid hardcoding
// @font-face.
//
// This copies all non-VF Red Hat fonts to our `static/fonts/` directory.
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

// Different directory structure than our redhat_fonts, which makes it easier
// to use the Patternfly default src and avoid hardcoding our own @font-face.
//
// This copies all variable fonts (VF in the name) to subdirectories:
// static/fonts/
// ├── RedHatDisplay
// │   └── RedHatDisplayVF.woff2
// ├── RedHatMono
// │   ├── RedHatMonoVF-Italic.woff2
// │   └── RedHatMonoVF.woff2
// ├── RedHatText
// │   ├── RedHatTextVF-Italic.woff2
// │   └── RedHatTextVF.woff2
const redhat_fonts_variable_font = [
    "Text",
    "Display",
    "Mono",
].flatMap(name => {
    const subdir = 'RedHat' + name;
    const fontsdir = '@patternfly/patternfly/assets/fonts';
    const fontsDirPath = path.resolve(nodedir, fontsdir, subdir);

    return fs.readdirSync(fontsDirPath)
            .filter(file => file.includes('VF') && file.endsWith('.woff2'))
            .map(file => ({
                from: path.resolve(fontsDirPath, file),
                to: `static/fonts/${subdir}`
            }));
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

    return ({ entryPoints, assetFiles: files, redhat_fonts: redhat_fonts.concat(redhat_fonts_variable_font) });
};

export const getTestFiles = () => info.tests;
