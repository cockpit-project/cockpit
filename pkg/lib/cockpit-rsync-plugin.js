import child_process from 'child_process';

export default class {
    constructor(options) {
        if (!options)
            options = {};
        this.dest = options.dest || "";
        this.source = options.source || "dist/";
        this.ssh_host = process.env.RSYNC || process.env.RSYNC_DEVEL;

        // ensure the target directory exists
        if (this.ssh_host) {
            this.rsync_dir = process.env.RSYNC ? "/usr/local/share/cockpit/" : "~/.local/share/cockpit/";
            child_process.spawnSync("ssh", [this.ssh_host, "mkdir", "-p", this.rsync_dir], { stdio: "inherit" });
        }
    }

    apply(compiler) {
        compiler.hooks.afterEmit.tapAsync('WebpackHookPlugin', (compilation, callback) => {
            if (this.ssh_host) {
                const proc = child_process.spawn("rsync", ["--recursive", "--info=PROGRESS2", "--delete",
                    this.source, this.ssh_host + ":" + this.rsync_dir + this.dest], { stdio: "inherit" });
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
}
