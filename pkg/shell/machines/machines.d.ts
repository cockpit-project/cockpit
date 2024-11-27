import { EventSource, EventMap } from "cockpit";

export function generate_connection_string(user: string | null, port: string | null, addr: string) : string;
export function split_connection_string (conn_to: string) : { address: string, user?: string, port?: number };

export interface ManifestKeyword {
    matches: string[];
    goto?: string;
    weight: number;
    translate: boolean;
}

export interface ManifestDocs {
    label: string;
    url: string;
}

export interface ManifestEntry {
    path?: string;
    label?: string;
    order?: number;
    docs?: ManifestDocs[];
    keywords?: ManifestKeyword[];
}

export interface ManifestSection {
    [name: string]: ManifestEntry;
}

export interface Manifest {
    [section: string]: ManifestSection;
}

export interface Manifests {
    [pkg: string]: Manifest;
}

export interface Machine {
    key: string;
    connection_string: string;
    address: string;
    user?: string;
    port?: number;
    label: string;
    state: null | "failed" | "connecting" | "connected";
    manifests?: Manifests;
    checksum?: string;
    visible?: boolean;
    problem: string | null;
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
}

interface Loader {
    connect: (connection_string: string) => void;
    expect_restart: (connection_string: string) => void;
}

export const machines: {
    instance: () => Machines;
    loader: (machines: Machines) => Loader;
};
