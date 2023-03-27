#!/usr/bin/env node

import child_process from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';

import { getFiles, getTestFiles, all_subdirs } from './files.js';

const production = process.env.NODE_ENV === 'production';
const useWasm = os.arch() != 'x64';

// ensure node_modules is present and up to date
child_process.spawnSync('tools/node-modules', ['make_package_lock_json'], { stdio: 'inherit' });

// List of directories to use when resolving import statements
const nodePaths = ['pkg/lib'];

// context options for distributed pages in dist/
const pkgOptions = {
    ...!production ? { sourcemap: "external" } : {},
    bundle: true,
    external: ['*.woff', '*.woff2', '*.jpg', '*.svg', '../../assets*'], // Allow external font files which live in ../../static/fonts
    legalComments: 'external', // Move all legal comments to a .LEGAL.txt file
    loader: {
        ".js": "jsx",
        ".py": "text",
        ".sh": "text",
    },
    minify: production,
    nodePaths,
    outbase: './pkg',
    outdir: "./dist",
    target: ['es2020'],
};

// context options for qunit tests in qunit/
const qunitOptions = {
    bundle: true,
    minify: false,
    nodePaths,
    outbase: './pkg',
    outdir: "./qunit",
    loader: {
        ".sh": "text",
    },
};

const parser = (await import('argparse')).default.ArgumentParser();
parser.add_argument('-r', '--rsync', { help: "rsync bundles to ssh target after build", metavar: "HOST" });
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable watch mode" });
parser.add_argument('-e', '--no-eslint', { action: 'store_true', help: "Disable eslint linting", default: production });
parser.add_argument('-s', '--no-stylelint', { action: 'store_true', help: "Disable stylelint linting", default: production });
parser.add_argument('onlydir', { nargs: '?', help: "The pkg/<DIRECTORY> to build (eg. base1, shell, ...)", metavar: "DIRECTORY" });
const args = parser.parse_args();

if (args.onlydir?.includes('/'))
    parser.error("Directory must not contain '/'");

if (useWasm && args.watch)
    parser.error("watch mode is not supported with esbuild-wasm");

if (args.onlydir)
    process.env.ONLYDIR = args.onlydir;
if (args.rsync)
    process.env.RSYNC = args.rsync;

// keep cockpit.js as global external, except on base1 (as that's what exports it), and kdump (for testing that bundling works)
const cockpitJSResolvePlugin = {
    name: 'cockpit-js-resolve',
    setup(build) {
        build.onResolve({ filter: /^cockpit$/ }, args => {
            if (args.resolveDir.endsWith('/base1') || args.resolveDir.endsWith('/kdump'))
                return null;
            return { path: args.path, namespace: 'external-global' };
        });

        build.onLoad({ filter: /.*/, namespace: 'external-global' },
                     args => ({ contents: `module.exports = ${args.path}` }));
    },
};

// similar to fs.watch(), but recursively watches all subdirectories
function watch_dirs(dir, on_change) {
    const callback = (ev, dir, fname) => {
        // only listen for "change" events, as renames are noisy
        if (ev !== "change")
            return;
        on_change(path.join(dir, fname));
    };

    fs.watch(dir, {}, (ev, path) => callback(ev, dir, path));

    // watch all subdirectories in dir
    const d = fs.opendirSync(dir);
    let dirent;
    while ((dirent = d.readSync()) !== null) {
        if (dirent.isDirectory())
            watch_dirs(path.join(dir, dirent.name), on_change);
    }
    d.closeSync();
}

async function build() {
    // dynamic imports which need node_modules
    const copy = (await import('esbuild-plugin-copy')).default;
    const esbuild = (await import(useWasm ? 'esbuild-wasm' : 'esbuild')).default;

    const cleanPlugin = (await import('./pkg/lib/esbuild-cleanup-plugin.js')).cleanPlugin;
    const cockpitCompressPlugin = (await import('./pkg/lib/esbuild-compress-plugin.js')).cockpitCompressPlugin;
    const cockpitPoEsbuildPlugin = (await import('./pkg/lib/cockpit-po-plugin.js')).cockpitPoEsbuildPlugin;
    const cockpitRsyncEsbuildPlugin = (await import('./pkg/lib/cockpit-rsync-plugin.js')).cockpitRsyncEsbuildPlugin;
    const cockpitTestHtmlPlugin = (await import('./pkg/lib/esbuild-test-html-plugin.js')).cockpitTestHtmlPlugin;
    const eslintPlugin = (await import('./pkg/lib/esbuild-eslint-plugin.js')).eslintPlugin;
    const stylelintPlugin = (await import('./pkg/lib/esbuild-stylelint-plugin.js')).stylelintPlugin;

    const esbuildStylesPlugins = (await import('./pkg/lib/esbuild-common.js')).esbuildStylesPlugins;

    const { entryPoints, assetFiles, redhat_fonts } = getFiles(args.onlydir);
    const tests = getTestFiles();
    const testEntryPoints = tests.map(test => "pkg/" + test + ".js");

    const pkgFirstPlugins = [
        cleanPlugin({ subdir: args.onlydir }),
    ];

    const pkgPlugins = [
        ...args.no_stylelint ? [] : [stylelintPlugin({ filter: /pkg\/.*\.(css?|scss?)$/ })],
        ...args.no_eslint ? [] : [eslintPlugin({ filter: /pkg\/.*\.(jsx?|js?)$/ })],
        cockpitJSResolvePlugin,
        ...esbuildStylesPlugins
    ];

    const getTime = () => new Date().toTimeString().split(' ')[0];

    const pkgLastPlugins = [
        cockpitPoEsbuildPlugin({
            subdirs: args.onlydir ? [args.onlydir] : all_subdirs,
            // login page does not have cockpit.js, but reads window.cockpit_po
            wrapper: subdir => subdir == "static" ? "window.cockpit_po = PO_DATA;" : undefined,
        }),
        // Esbuild will only copy assets that are explicitly imported and used
        // in the code. This is a problem for index.html and manifest.json which are not imported
        copy({ assets: [...assetFiles, ...redhat_fonts] }),
        // cockpit-ws cannot currently serve compressed login page
        ...production ? [cockpitCompressPlugin({ subdir: args.onlydir, exclude: /\/static/ })] : [],

        {
            name: 'notify-end',
            setup(build) {
                build.onEnd(() => console.log(`${getTime()}: Build finished`));
            }
        },

        ...args.rsync ? [cockpitRsyncEsbuildPlugin({ source: "dist/" + (args.onlydir || '') })] : [],
    ];

    if (useWasm) {
        // build each entry point individually, as otherwise it runs out of memory
        // See https://github.com/evanw/esbuild/issues/3006
        const numEntries = entryPoints.length;
        for (const [index, entryPoint] of entryPoints.entries()) {
            console.log("building", entryPoint);
            const context = await esbuild.context({
                ...pkgOptions,
                entryPoints: [entryPoint],
                plugins: [
                    ...(index === 0 ? pkgFirstPlugins : []),
                    ...pkgPlugins,
                    ...(index === numEntries - 1 ? pkgLastPlugins : []),
                ],
            });

            await context.rebuild();
            context.dispose();
        }

        // build all tests in one go, they are small enough
        console.log("building qunit tests");
        const context = await esbuild.context({
            ...qunitOptions,
            entryPoints: testEntryPoints,
            plugins: [
                ...args.no_stylelint ? [] : [stylelintPlugin({ filter: /pkg\/.*\.(css?|scss?)$/ })],
                ...args.no_eslint ? [] : [eslintPlugin({ filter: /pkg\/.*\.(jsx?|js?)$/ })],
                cockpitTestHtmlPlugin({ testFiles: tests }),
            ],
        });

        await context.rebuild();
        context.dispose();
    } else {
        // with native esbuild, build everything in one go, that's fastest
        const pkgContext = await esbuild.context({
            ...pkgOptions,
            entryPoints,
            plugins: [...pkgFirstPlugins, ...pkgPlugins, ...pkgLastPlugins],
        });

        const qunitContext = await esbuild.context({
            ...qunitOptions,
            entryPoints: testEntryPoints,
            plugins: [
                ...args.no_stylelint ? [] : [stylelintPlugin({ filter: /pkg\/.*\.(css?|scss?)$/ })],
                ...args.no_eslint ? [] : [eslintPlugin({ filter: /pkg\/.*\.(jsx?|js?)$/ })],
                cockpitTestHtmlPlugin({ testFiles: tests }),
            ],
        });

        try {
            await Promise.all([pkgContext.rebuild(), qunitContext.rebuild()]);
        } catch (e) {
            if (!args.watch)
                process.exit(1);
            // ignore errors in watch mode
        }

        if (args.watch) {
            const on_change = async path => {
                console.log("change detected:", path);
                await Promise.all([pkgContext.cancel(), qunitContext.cancel()]);
                try {
                    await Promise.all([pkgContext.rebuild(), qunitContext.rebuild()]);
                } catch (e) {} // ignore in watch mode
            };

            watch_dirs('pkg', on_change);
            // wait forever until Control-C
            await new Promise(() => {});
        }

        pkgContext.dispose();
        qunitContext.dispose();
    }
}

build();
