#!/usr/bin/env node

import webpack from 'webpack';
import path from 'path';
import argparse from 'argparse';
import process from 'process';
import { CockpitRsyncWebpackPlugin } from '../pkg/lib/cockpit-rsync-plugin.js';

// argv0 is node
const webpack_watch = process.argv[1].includes('webpack-watch');

const parser = argparse.ArgumentParser();
parser.add_argument('-c', '--config', { help: "Path to webpack.config.js", default: "webpack.config.js" });
parser.add_argument('-r', '--rsync', { help: "rsync webpack to ssh target after build", metavar: "HOST" });
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable webpack watch mode", default: webpack_watch });
parser.add_argument('-e', '--no-eslint', { action: 'store_true', help: "Disable eslint linting" });
parser.add_argument('-s', '--no-stylelint', { action: 'store_true', help: "Disable stylelint linting" });
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

import(config_path).then(module => {
    const config = module.default;
    if (args.rsync) {
        process.env.RSYNC = args.rsync;
        config.plugins.push(new CockpitRsyncWebpackPlugin({ source: "dist/" + (args.onlydir || "") }));
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
});

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
    }
}
