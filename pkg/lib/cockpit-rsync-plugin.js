const child_process = require("child_process");

module.exports = class {
    constructor(options) {
        if (!options)
            options = {};
        this.dest = options.dest || "";
        this.source = options.source || "dist/";
    }

    apply(compiler) {
        compiler.hooks.afterEmit.tapAsync('WebpackHookPlugin', (compilation, callback) => {
            if (process.env.RSYNC) {
                const proc = child_process.spawn("rsync", ["--recursive", "--info=PROGRESS2", "--delete",
                    this.source, process.env.RSYNC + ":/usr/share/cockpit/" + this.dest], { stdio: "inherit" });
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
