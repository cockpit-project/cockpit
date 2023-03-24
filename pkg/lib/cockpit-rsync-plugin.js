import child_process from "child_process";

const config = {};

function init(options) {
    config.dest = options.dest || "";
    config.source = options.source || "dist/";
    config.ssh_host = process.env.RSYNC || process.env.RSYNC_DEVEL;

    // ensure the target directory exists
    if (config.ssh_host) {
        config.rsync_dir = process.env.RSYNC ? "/usr/local/share/cockpit/" : "~/.local/share/cockpit/";
        child_process.spawnSync("ssh", [config.ssh_host, "mkdir", "-p", config.rsync_dir], { stdio: "inherit" });
    }
}

function run(callback) {
    if (config.ssh_host) {
        const proc = child_process.spawn("rsync", ["--recursive", "--info=PROGRESS2", "--delete",
            config.source, config.ssh_host + ":" + config.rsync_dir + config.dest], { stdio: "inherit" });
        proc.on('close', (code) => {
            if (code !== 0) {
                process.exit(1);
            } else {
                callback();
            }
        });
    } else {
        callback();
    }
}

export const cockpitRsyncEsbuildPlugin = options => ({
    name: 'cockpitRsyncPlugin',
    setup(build) {
        init(options || {});
        build.onEnd(result => result.errors.length === 0 ? run(() => {}) : {});
    },
});

export class CockpitRsyncWebpackPlugin {
    constructor(options) {
        init(options || {});
    }

    apply(compiler) {
        compiler.hooks.afterEmit.tapAsync('WebpackHookPlugin', (_compilation, callback) => run(callback));
    }
}
