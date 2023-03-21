#!/usr/bin/env node

import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import process from 'process';

// ensure node_modules is present and up to date
child_process.spawnSync('tools/node-modules', ['make_package_lock_json'], { stdio: 'inherit' });

// argv0 is node
const webpack_watch = process.argv[1].includes('webpack-watch');

const parser = (await import('argparse')).default.ArgumentParser();
parser.add_argument('-c', '--config', { help: "Path to webpack.config.js", default: "webpack.config.js" });
parser.add_argument('-r', '--rsync', { help: "rsync webpack to ssh target after build", metavar: "HOST" });
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable webpack watch mode", default: webpack_watch });
parser.add_argument('-e', '--no-eslint', { action: 'store_true', help: "Disable eslint linting" });
parser.add_argument('-s', '--no-stylelint', { action: 'store_true', help: "Disable stylelint linting" });
parser.add_argument('--test-mtime', { metavar: "PATH", help: "Only rebuild if PATH is older than pkg/* and package-lock.json" });
parser.add_argument('onlydir', { nargs: '?', help: "The pkg/<DIRECTORY> to build (eg. base1, shell, ...)", metavar: "DIRECTORY" });
const args = parser.parse_args();

if (args.no_eslint) {
    process.env.ESLINT = "0";
} else if (args.watch) {
    process.env.ESLINT = "1";
}

if (args.no_stylelint) {
    process.env.STYLELINT = "0";
} else if (args.watch) {
    process.env.STYLELINT = "1";
}

if (args.onlydir?.includes('/')) {
    parser.error("Directory must not contain '/'");
}

if (args.onlydir)
    process.env.ONLYDIR = args.onlydir;

const cwd = process.cwd();
const config_path = path.resolve(cwd, args.config);

function process_result(err, stats) {
    // process.stdout.write(stats.toString({colors: true}) + "\n");

    if (err) {
        console.log(JSON.stringify(err));
        process.exit(1);
    }

    if (args.watch) {
        const info = stats.toJson();
        const time = new Date().toTimeString().split(' ')[0];
        process.stdout.write(`${time} Build succeeded, took ${info.time / 1000}s\n`);
    }

    // Failure exit code when compilation fails
    if (stats.hasErrors() || stats.hasWarnings())
        console.log(stats.toString("normal"));

    if (stats.hasErrors()) {
        if (!args.watch)
            process.exit(1);
    } else if (!args.watch && args.test_mtime) {
        // webpack won't touch the stamp file if the contents didn't change, so force that
        fs.closeSync(fs.openSync(args.test_mtime, 'w'));
    }
}

async function build() {
    // dynamic imports which need node_modules
    const config = (await import(config_path)).default;
    const webpack = (await import('webpack')).default;
    const cockpit_rsync = (await import('../pkg/lib/cockpit-rsync-plugin.js'));

    if (args.rsync) {
        process.env.RSYNC = args.rsync;
        config.plugins.push(new cockpit_rsync.CockpitRsyncWebpackPlugin({ source: "dist/" + (args.onlydir || "") }));
    }

    const compiler = webpack(config);

    if (args.watch) {
        compiler.hooks.watchRun.tap("WebpackInfo", compilation => {
            const time = new Date().toTimeString().split(' ')[0];
            process.stdout.write(`${time} Build started\n`);
        });
        compiler.watch(config.watchOptions, process_result);
    } else {
        compiler.run(process_result);
    }
}

// return most recent mtime of a file or directory; 0 if it does not exist
function most_recent(path) {
    let stat;
    try {
        stat = fs.statSync(path);
    } catch (ex) {
        if (ex.code === "ENOENT")
            return 0;
        throw ex;
    }

    let max_mtime = 0;
    if (stat.isDirectory()) {
        for (const file of fs.readdirSync(path)) {
            // ignore automake test logs
            if (file.endsWith(".log") || file.endsWith(".trs"))
                continue;
            max_mtime = Math.max(max_mtime, most_recent(path + "/" + file));
        }
    } else {
        max_mtime = Math.max(max_mtime, stat.mtimeMs);
    }

    return max_mtime;
}

// check if anything in pkg/ or our package-lock.js is newer than stampfile
function needs_update(stampfile) {
    const lock_mtime = most_recent("package-lock.json");
    const pkg_mtime = most_recent("pkg");
    const stamp_mtime = most_recent(stampfile);
    return lock_mtime > stamp_mtime || pkg_mtime > stamp_mtime;
}

if (args.watch || !args.test_mtime || needs_update(args.test_mtime))
    build();
