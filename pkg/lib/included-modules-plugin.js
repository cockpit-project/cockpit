module.exports = class {
    constructor(filename) {
        this.filename = filename;
    }

    apply(compiler) {
        compiler.hooks.emit.tap('IncludedModulesPlugin', compilation => {
            let modules = { };

            for (const file of compilation.fileDependencies) {
                const parts = file.split("/");
                const node_modules_index = parts.indexOf("node_modules");
                let module_index = parts.lastIndexOf("node_modules") + 1;

                if (node_modules_index && module_index) {
                    if (parts[module_index].startsWith("@")) {
                        module_index++;
                    }

                    const dir = parts.slice(node_modules_index, module_index + 1).join("/");
                    modules[dir] = true;
                }
            }

            modules = Object.keys(modules).sort();
            let content = modules.join("\n");
            if (content) {
                content += "\n";
            }

            compilation.assets[this.filename] = {
                source: () => content,
                size: () => content.length
            };
        });
    }
};
