import cockpit from "cockpit";

export class UsageMonitor {
    constructor() {
        this.channel = cockpit.metrics(
            1000,
            [
                {
                    source: "direct",
                    metrics: [
                        {
                            name: "network.interface.in.bytes",
                            units: "bytes",
                            derive: "rate"
                        },
                        {
                            name: "network.interface.out.bytes",
                            units: "bytes",
                            derive: "rate"
                        },
                    ],
                    metrics_path_names: ["rx", "tx"]
                },
                {
                    source: "internal",
                    metrics: [
                        {
                            name: "network.interface.rx",
                            units: "bytes",
                            derive: "rate"
                        },
                        {
                            name: "network.interface.tx",
                            units: "bytes",
                            derive: "rate"
                        },
                    ],
                    metrics_path_names: ["rx", "tx"]
                }
            ]
        );

        this.grid = cockpit.grid(1000, -1, -0);
        this.samples = { };

        this.channel.follow();
        this.grid.walk();
    }

    add(iface) {
        if (!this.samples[iface]) {
            this.samples[iface] = [
                this.grid.add(this.channel, ["rx", iface]),
                this.grid.add(this.channel, ["tx", iface])
            ];
        }
    }
}
