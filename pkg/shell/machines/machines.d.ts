import { EventSource, EventMap } from "cockpit";

import { Manifests } from "../manifests";

export function generate_connection_string(user: string | null, port: string | null, addr: string) : string;
export function split_connection_string (conn_to: string) : { address: string, user?: string, port?: number };
export function get_init_superuser_for_options (options: {[key: string]: string }) : string | null;
export function host_superuser_storage_key (host?: string): string | null;

export interface Machine {
    key: string;
    connection_string: string;
    address: string;
    user?: string;
    port?: number;
    label: string;
    color?: string;
    state: null | "failed" | "connecting" | "connected";
    manifests?: Manifests;
    checksum?: string;
    visible?: boolean;
    problem: string | null;
    restarting?: boolean;
}

interface MachinesEvents extends EventMap {
    ready: () => void;
    added: (machine: Machine) => void;
    removed: (machine: Machine) => void;
    updated: (machine: Machine) => void;
}

export interface Machines extends EventSource<MachinesEvents> {
    ready: boolean;

    lookup: (conection_string: string) => Machine;
    list: Machine[];
    change: (key: string, props: Partial<Machine>) => void;
}

interface Loader {
    connect: (connection_string: string) => void;
    expect_restart: (connection_string: string) => void;
}

export const machines: {
    instance: () => Machines;
    loader: (machines: Machines) => Loader;
};
