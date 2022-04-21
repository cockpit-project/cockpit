const child_process = require("child_process");

module.exports = class {
    constructor(options) {
        if (!options)
            options = {};
        this.dest = options.dest || "";
        this.source = options.source || "dist/";

        // ensure the target directory exists
        if (process.env.RSYNC)
            child_process.spawnSync("ssh", [process.env.RSYNC, "mkdir", "-p", "/usr/local/share/cockpit/"], { stdio: "inherit" });
    }

    apply(compiler) {
        compiler.hooks.afterEmit.tapAsync('WebpackHookPlugin', (compilation, callback) => {
            if (process.env.RSYNC) {
                const proc = child_process.spawn("rsync", ["--recursive", "--info=PROGRESS2", "--delete",
                    this.source, process.env.RSYNC + ":/usr/local/share/cockpit/" + this.dest], { stdio: "inherit" });
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
        });
    }
};
