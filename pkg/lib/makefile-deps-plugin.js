const onlydir = process.env.ONLYDIR || '';
const fs = require('fs');

module.exports = class {
    constructor(filename) {
        this.filename = filename;
    }

    apply(compiler) {
        compiler.hooks.done.tap('MakefileDepsPlugin', stats => {
            const depends = [];

            for (const file of stats.compilation.fileDependencies) {
                const pkgdir_index = file.indexOf("/pkg/");

                if (pkgdir_index !== -1 && !file.includes("node_modules/")) {
                    depends.push(file.slice(pkgdir_index + 1));
                }
            }

            const content = "dist/" + onlydir + "stamp: " + depends.join(" ") + "\n";
            const filename = "dist/" + onlydir + this.filename;
            fs.writeFileSync(filename, content);
        });
    }
};
