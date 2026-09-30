/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import '../lib/patternfly/patternfly-6-cockpit.scss';
import 'polyfills';
import 'cockpit-dark-theme';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import cockpit from 'cockpit';
import { fsinfo, FsInfoClient } from 'cockpit/fsinfo';
import { basename, dirname } from 'cockpit-path';
import { useLoggedInUser, usePageLocation } from 'hooks';
import { superuser } from 'superuser';
import { SuperuserButton } from 'superuser-dialogs';
import { WithDialogs, useDialogs } from 'dialogs.jsx';
import { upload } from 'cockpit-upload-helper';
import * as timeformat from 'timeformat';

import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Breadcrumb, BreadcrumbItem } from '@patternfly/react-core/dist/esm/components/Breadcrumb/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Card, CardBody, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { Content } from '@patternfly/react-core/dist/esm/components/Content/index.js';
import { DropdownItem } from '@patternfly/react-core/dist/esm/components/Dropdown/index.js';
import { Flex, FlexItem } from '@patternfly/react-core/dist/esm/layouts/Flex/index.js';
import { Form, FormGroup } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { InputGroup, InputGroupItem } from '@patternfly/react-core/dist/esm/components/InputGroup/index.js';
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Page, PageSection } from '@patternfly/react-core/dist/esm/components/Page/index.js';
import { Progress } from '@patternfly/react-core/dist/esm/components/Progress/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { Title, TitleSizes } from '@patternfly/react-core/dist/esm/components/Title/index.js';
import {
    ArrowLeftIcon, CopyIcon, DownloadIcon, ExchangeAltIcon, FileIcon, FileMedicalIcon,
    FolderIcon, FolderPlusIcon, PencilAltIcon, TerminalIcon, TrashIcon, UploadIcon,
} from '@patternfly/react-icons';

import { EmptyStatePanel } from 'cockpit-components-empty-state.jsx';
import { KebabDropdown } from 'cockpit-components-dropdown';
import { ListingTable } from 'cockpit-components-table.jsx';

import './folders.scss';

const _ = cockpit.gettext;

/* Reload when administrative access is turned on or off, so that listings and
 * file contents are re-read with the new privileges. */
superuser.reload_page_on_change();

/* Use elevated privileges when they are available, but keep working without. */
const SUPERUSER = { superuser: 'try' };

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']);
const TEXT_EXT = new Set([
    'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss',
    'js', 'jsx', 'ts', 'tsx', 'py', 'sh', 'bash', 'conf', 'cfg', 'ini', 'log', 'csv',
    'toml', 'env', 'service', 'timer', 'rules', 'list',
]);
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function joinPath(base, name) {
    if (base === '/')
        return `/${name}`;
    return `${base}/${name}`;
}

function extension(path) {
    const base = basename(path);
    const dot = base.lastIndexOf('.');
    if (dot <= 0)
        return '';
    return base.slice(dot + 1).toLowerCase();
}

function formatSize(type, size) {
    if (type === 'dir')
        return '—';
    if (size === undefined)
        return '—';
    return cockpit.format_bytes(size);
}

function formatMtime(mtime) {
    if (mtime === undefined)
        return '—';
    return timeformat.dateTime(mtime * 1000);
}

function formatMode(mode) {
    if (mode === undefined)
        return '—';
    return (mode & 0o7777).toString(8).padStart(4, '0');
}

function formatOwner(entry) {
    const user = entry.user ?? '?';
    const group = entry.group ?? '?';
    return `${user}:${group}`;
}

function navigate(options) {
    cockpit.location.go([], options);
}

function run(argv) {
    return cockpit.spawn(argv, { ...SUPERUSER, err: 'message' });
}

async function exists(path) {
    try {
        await fsinfo(path, ['type'], SUPERUSER);
        return true;
    } catch (err) {
        if (err.problem === 'not-found')
            return false;
        throw err;
    }
}

function errorString(err) {
    return err?.message || err?.problem || String(err);
}

/* Downloads through an external channel, so the file is streamed by cockpit-ws
 * instead of being buffered in the browser. Same approach as Diagnostic reports. */
function downloadFile(path) {
    const query = window.btoa(JSON.stringify({
        host: cockpit.transport.host,
        payload: 'fsread1',
        binary: 'raw',
        path,
        superuser: 'try',
        max_read_size: -1,
        external: {
            'content-disposition': `attachment; filename="${basename(path)}"`,
            'content-type': 'application/octet-stream',
        },
    }));
    const prefix = (new URL(cockpit.transport.uri(`channel/${cockpit.transport.csrf_token}`))).pathname;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', `${prefix}?${query}`);
    iframe.setAttribute('hidden', 'hidden');
    document.body.appendChild(iframe);
}

function useDirectoryListing(path) {
    const [state, setState] = useState({ loading: true });

    useEffect(() => {
        if (!path) {
            setState({ loading: true });
            return undefined;
        }
        const attrs = ['entries', 'type', 'size', 'mtime', 'mode', 'user', 'group', 'target'];
        const client = new FsInfoClient(path, attrs, SUPERUSER);
        const update = () => setState({ ...client.state });
        client.on('change', update);
        update();
        return () => client.close();
    }, [path]);

    return state;
}

/* --- Dialogs ------------------------------------------------------------- */

const PromptDialog = ({ title, label, initial, confirmLabel, helper, onConfirm }) => {
    const Dialogs = useDialogs();
    const [value, setValue] = useState(initial ?? '');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const apply = async () => {
        setBusy(true);
        setError(null);
        try {
            await onConfirm(value.trim());
            Dialogs.close();
        } catch (err) {
            setError(errorString(err));
            setBusy(false);
        }
    };

    return (
        <Modal isOpen position="top" variant="small" onClose={Dialogs.close}>
            <ModalHeader title={title} />
            <ModalBody>
                {error && <Alert variant="danger" isInline title={error} />}
                <Form isHorizontal onSubmit={ev => { ev.preventDefault(); apply() }}>
                    <FormGroup label={label} fieldId="folders-prompt-value">
                        <TextInput id="folders-prompt-value" value={value} autoFocus
                                   onChange={(_ev, v) => setValue(v)} />
                        {helper && <Content component="small">{helper}</Content>}
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={apply} isDisabled={busy || !value.trim()} isLoading={busy}>
                    {confirmLabel}
                </Button>
                <Button variant="link" onClick={Dialogs.close}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

const DeleteDialog = ({ path, isDir, onConfirm }) => {
    const Dialogs = useDialogs();
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    const apply = async () => {
        setBusy(true);
        setError(null);
        try {
            await onConfirm();
            Dialogs.close();
        } catch (err) {
            setError(errorString(err));
            setBusy(false);
        }
    };

    return (
        <Modal isOpen position="top" variant="small" onClose={Dialogs.close}>
            <ModalHeader title={isDir ? _("Delete folder?") : _("Delete file?")} titleIconVariant="warning" />
            <ModalBody>
                {error && <Alert variant="danger" isInline title={error} />}
                <Content component="p">{path}</Content>
                {isDir &&
                    <Content component="p">{_("Everything inside this folder is deleted too. This cannot be undone.")}</Content>
                }
            </ModalBody>
            <ModalFooter>
                <Button variant="danger" onClick={apply} isDisabled={busy} isLoading={busy}>{_("Delete")}</Button>
                <Button variant="link" onClick={Dialogs.close}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

const UploadDialog = ({ dir }) => {
    const Dialogs = useDialogs();
    const [files, setFiles] = useState([]);
    const [error, setError] = useState(null);
    const [current, setCurrent] = useState(null);
    const [percent, setPercent] = useState(0);
    const [busy, setBusy] = useState(false);
    const abortRef = useRef(null);

    const apply = async () => {
        setBusy(true);
        setError(null);
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            for (const file of files) {
                setCurrent(file.name);
                setPercent(0);
                const target = joinPath(dir, file.name);
                if (await exists(target))
                    throw new Error(cockpit.format(_("$0 already exists"), target));
                await upload(target, file,
                             sent => setPercent(file.size ? Math.round(sent / file.size * 100) : 100),
                             controller.signal, SUPERUSER);
            }
            Dialogs.close();
        } catch (err) {
            setError(errorString(err));
            setBusy(false);
        }
    };

    return (
        <Modal isOpen position="top" variant="medium" onClose={Dialogs.close}>
            <ModalHeader title={_("Upload files")} />
            <ModalBody>
                {error && <Alert variant="danger" isInline title={error} />}
                <Content component="p">{cockpit.format(_("Destination: $0"), dir)}</Content>
                <input type="file" multiple disabled={busy}
                       onChange={ev => setFiles(Array.from(ev.target.files || []))} />
                {busy && current &&
                    <Progress value={percent} title={current} className="pf-v6-u-mt-md" />
                }
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={apply} isDisabled={busy || files.length === 0} isLoading={busy}>
                    {_("Upload")}
                </Button>
                <Button variant="link"
                        onClick={() => { abortRef.current?.abort(); Dialogs.close() }}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

/* --- File preview and editor -------------------------------------------- */

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function readBinaryFile(path) {
    const channel = cockpit.channel({ payload: 'fsread1', path, binary: true, ...SUPERUSER });
    const parts = [];
    return new Promise((resolve, reject) => {
        channel.addEventListener('message', (_ev, data) => parts.push(data));
        channel.addEventListener('close', (_ev, message) => {
            if (message.problem) {
                reject(new Error(cockpit.message(message)));
                return;
            }
            const buffers = parts.map(p => typeof p === 'string' ? new TextEncoder().encode(p) : p);
            const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const b of buffers) {
                out.set(b, offset);
                offset += b.byteLength;
            }
            resolve(out);
        });
    });
}

function TextEditor({ filePath }) {
    const [text, setText] = useState(null);
    const [saved, setSaved] = useState(null);
    const [tag, setTag] = useState(null);
    const [diskTag, setDiskTag] = useState(null);
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const handleRef = useRef(null);

    useEffect(() => {
        setText(null);
        setSaved(null);
        setError(null);
        setStatus(null);

        const handle = cockpit.file(filePath, SUPERUSER);
        handleRef.current = handle;

        /* watch() delivers both content and the tag we need for conflict-safe
         * saving, and keeps telling us when the file changes underneath us. */
        const watch = handle.watch((content, newTag, err) => {
            if (err) {
                setError(errorString(err));
                return;
            }
            setDiskTag(newTag);
            setText(prev => {
                // First load, or no local edits: adopt the content from disk.
                if (prev === null || prev === saved) {
                    setSaved(content ?? '');
                    setTag(newTag);
                    return content ?? '';
                }
                return prev;
            });
        });

        return () => {
            watch.remove();
            handle.close();
        };
    }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

    const dirty = text !== null && saved !== null && text !== saved;
    const staleOnDisk = tag !== null && diskTag !== null && diskTag !== tag;

    /* Warn before leaving the page with unsaved edits. */
    useEffect(() => {
        if (!dirty)
            return undefined;
        const onBeforeUnload = ev => { ev.preventDefault(); ev.returnValue = '' };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    const save = async (force) => {
        setBusy(true);
        setError(null);
        setStatus(null);
        try {
            // Passing the tag makes the bridge refuse the write if the file
            // changed since we read it, instead of silently overwriting.
            const newTag = await handleRef.current.replace(text, force ? undefined : tag);
            setTag(newTag);
            setDiskTag(newTag);
            setSaved(text);
            setStatus(_("Saved."));
        } catch (err) {
            if (err.problem === 'change-conflict')
                setError(_("This file changed on disk since you opened it. Reload to get the new version, or save again to overwrite it."));
            else
                setError(errorString(err));
        } finally {
            setBusy(false);
        }
    };

    const reload = async () => {
        try {
            const content = await handleRef.current.read();
            const info = await fsinfo(filePath, ['tag'], SUPERUSER);
            setText(content ?? '');
            setSaved(content ?? '');
            setTag(info.tag);
            setDiskTag(info.tag);
            setStatus(_("Reloaded."));
            setError(null);
        } catch (err) {
            setError(errorString(err));
        }
    };

    if (text === null && !error)
        return <EmptyStatePanel loading />;

    return (
        <>
            {error && <Alert variant="warning" isInline title={error} />}
            {!error && staleOnDisk && !dirty &&
                <Alert variant="info" isInline title={_("This file changed on disk.")} />
            }
            <textarea className="folders-editor pf-v6-c-form-control" value={text ?? ''}
                      spellCheck="false"
                      onChange={ev => setText(ev.target.value)} />
            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}
                  className="pf-v6-u-mt-md">
                <FlexItem>
                    <Button variant="primary" onClick={() => save(false)}
                            isDisabled={busy || !dirty} isLoading={busy}>
                        {_("Save")}
                    </Button>
                </FlexItem>
                <FlexItem>
                    <Button variant="secondary" onClick={reload} isDisabled={busy}>{_("Reload")}</Button>
                </FlexItem>
                {dirty && <FlexItem><Content component="small">{_("Unsaved changes")}</Content></FlexItem>}
                {status && <FlexItem><Content component="small">{status}</Content></FlexItem>}
            </Flex>
        </>
    );
}

function FilePreview({ filePath, isFocused }) {
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [imageUrl, setImageUrl] = useState(null);
    const [meta, setMeta] = useState(null);
    const [editable, setEditable] = useState(false);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            setLoading(true);
            setError(null);
            setImageUrl(null);
            setEditable(false);

            try {
                const info = await fsinfo(filePath, ['type', 'size', 'mtime', 'mode', 'user', 'group'], SUPERUSER);
                if (cancelled)
                    return;
                setMeta(info);

                const ext = extension(filePath);
                const size = info.size ?? 0;

                if (IMAGE_EXT.has(ext) && size <= MAX_IMAGE_BYTES) {
                    const bytes = await readBinaryFile(filePath);
                    if (cancelled)
                        return;
                    const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                    // Cockpit's default CSP allows data: but not blob: for img-src
                    setImageUrl(await blobToDataUrl(new Blob([bytes], { type: mime })));
                } else if (TEXT_EXT.has(ext) || size <= MAX_TEXT_BYTES) {
                    setEditable(true);
                }
            } catch (err) {
                if (!cancelled)
                    setError(errorString(err));
            } finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();

        return () => { cancelled = true };
    }, [filePath]);

    return (
        <Card isPlain className={`folders-preview-pane${isFocused ? ' folders-preview-focused' : ''}`}>
            <CardTitle>
                <Flex alignItems={{ default: 'alignItemsCenter' }}
                      justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                    <FlexItem>{basename(filePath)}</FlexItem>
                    <FlexItem>
                        <Button variant="secondary" icon={<DownloadIcon />}
                                onClick={() => downloadFile(filePath)}>
                            {_("Download")}
                        </Button>
                    </FlexItem>
                </Flex>
            </CardTitle>
            <CardBody>
                {error && <Alert variant="danger" isInline title={error} />}
                {meta &&
                    <Content component="p" className="folders-meta">
                        {formatSize('reg', meta.size)} · {formatMtime(meta.mtime)} · {formatMode(meta.mode)} · {formatOwner(meta)}
                    </Content>
                }
                {loading && <EmptyStatePanel loading />}
                {!loading && imageUrl && <img src={imageUrl} alt={basename(filePath)} />}
                {!loading && editable && <TextEditor filePath={filePath} />}
                {!loading && !error && !imageUrl && !editable &&
                    <Content component="p">
                        {_("No preview for this file type. Use Download to fetch it.")}
                    </Content>
                }
            </CardBody>
        </Card>
    );
}

/* --- Navigation --------------------------------------------------------- */

function pathSegments(dir) {
    const parts = dir.split('/').filter(p => p !== '');
    const out = [{ name: '/', path: '/' }];
    let acc = '';
    for (const part of parts) {
        acc += `/${part}`;
        out.push({ name: part, path: acc });
    }
    return out;
}

function PathBar({ dir, home }) {
    const [value, setValue] = useState(dir);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setValue(dir);
        setError(null);
    }, [dir]);

    const submit = async event => {
        event?.preventDefault();

        let target = value.trim();
        if (!target)
            return;
        if (target === '~')
            target = home;
        else if (target.startsWith('~/'))
            target = joinPath(home, target.slice(2));
        if (!target.startsWith('/')) {
            setError(_("Enter an absolute path, starting with /"));
            return;
        }
        target = target.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

        setBusy(true);
        setError(null);
        try {
            const info = await fsinfo(target, ['type'], SUPERUSER);
            if (info.type === 'dir')
                navigate({ path: target });
            else
                navigate({ path: dirname(target), file: target });
        } catch (err) {
            setError(errorString(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Form onSubmit={submit} className="folders-path-form">
            <InputGroup>
                <InputGroupItem isFill>
                    <TextInput id="folders-path-input" className="folders-path-input"
                               aria-label={_("Path")} value={value}
                               onChange={(_ev, v) => setValue(v)}
                               onKeyDown={ev => { if (ev.key === 'Enter') submit(ev) }}
                               validated={error ? 'error' : 'default'}
                               placeholder={_("Type or paste a path, then press Enter")} />
                </InputGroupItem>
                <InputGroupItem>
                    <Button variant="control" onClick={submit} isDisabled={busy}>{_("Go")}</Button>
                </InputGroupItem>
            </InputGroup>
            {error && <Alert variant="warning" title={error} isInline isPlain />}
        </Form>
    );
}

/* --- Main body ---------------------------------------------------------- */

function FoldersBody() {
    const user = useLoggedInUser();
    const location = usePageLocation();
    const Dialogs = useDialogs();
    const dir = location.options.path || user?.home || '/';
    const file = location.options.file || null;
    const listing = useDirectoryListing(user ? dir : null);

    const [filter, setFilter] = useState('');
    const [showHidden, setShowHidden] = useState(false);

    const parent = dir === '/' ? null : dirname(dir);

    const newFolder = () => Dialogs.show(
        <PromptDialog title={_("Create folder")} label={_("Name")} confirmLabel={_("Create")}
                      onConfirm={name => {
                          if (name.includes('/'))
                              return Promise.reject(new Error(_("Name cannot contain /")));
                          return run(['mkdir', '--', joinPath(dir, name)]);
                      }} />);

    const newFile = () => Dialogs.show(
        <PromptDialog title={_("Create empty file")} label={_("Name")} confirmLabel={_("Create")}
                      onConfirm={name => {
                          if (name.includes('/'))
                              return Promise.reject(new Error(_("Name cannot contain /")));
                          return run(['touch', '--', joinPath(dir, name)]);
                      }} />);

    const rename = entryPath => Dialogs.show(
        <PromptDialog title={_("Rename")} label={_("New name")} confirmLabel={_("Rename")}
                      initial={basename(entryPath)}
                      onConfirm={async name => {
                          if (name.includes('/'))
                              throw new Error(_("Name cannot contain /"));
                          const target = joinPath(dirname(entryPath), name);
                          if (target === entryPath)
                              return;
                          if (await exists(target))
                              throw new Error(cockpit.format(_("$0 already exists"), target));
                          await run(['mv', '--', entryPath, target]);
                      }} />);

    const transfer = (entryPath, isCopy) => Dialogs.show(
        <PromptDialog title={isCopy ? _("Copy to") : _("Move to")}
                      label={_("Destination path")}
                      confirmLabel={isCopy ? _("Copy") : _("Move")}
                      initial={entryPath}
                      helper={_("Give a full destination path, including the new name.")}
                      onConfirm={async target => {
                          if (!target.startsWith('/'))
                              throw new Error(_("Enter an absolute path, starting with /"));
                          if (target === entryPath)
                              throw new Error(_("Source and destination are the same"));
                          if (await exists(target))
                              throw new Error(cockpit.format(_("$0 already exists"), target));
                          await run(isCopy ? ['cp', '-a', '--', entryPath, target] : ['mv', '--', entryPath, target]);
                      }} />);

    const remove = (entryPath, isDir) => Dialogs.show(
        <DeleteDialog path={entryPath} isDir={isDir}
                      onConfirm={async () => {
                          await run(['rm', '-rf', '--', entryPath]);
                          if (file === entryPath)
                              navigate({ path: dir });
                      }} />);

    const openTerminal = () => cockpit.jump(`/system/terminal?path=${encodeURIComponent(dir)}`);

    const rows = useMemo(() => {
        const entries = listing.info?.entries;
        if (!entries)
            return [];

        const needle = filter.trim().toLowerCase();

        return Object.keys(entries)
                .filter(name => name !== '.' && name !== '..')
                .filter(name => showHidden || !name.startsWith('.'))
                .filter(name => !needle || name.toLowerCase().includes(needle))
                .map(name => {
                    const entry = entries[name];
                    const isDir = entry.type === 'dir';
                    const full = joinPath(dir, name);
                    const open = () => {
                        if (isDir)
                            navigate({ path: full });
                        else
                            navigate({ path: dir, file: full });
                    };

                    const actions = (
                        <KebabDropdown position="right" dropdownItems={[
                            <DropdownItem key="rename" icon={<PencilAltIcon />}
                                          onClick={() => rename(full)}>{_("Rename")}</DropdownItem>,
                            <DropdownItem key="copy" icon={<CopyIcon />}
                                          onClick={() => transfer(full, true)}>{_("Copy to")}</DropdownItem>,
                            <DropdownItem key="move" icon={<ExchangeAltIcon />}
                                          onClick={() => transfer(full, false)}>{_("Move to")}</DropdownItem>,
                            ...(isDir
                                ? []
                                : [<DropdownItem key="download" icon={<DownloadIcon />}
                                                 onClick={() => downloadFile(full)}>{_("Download")}</DropdownItem>]),
                            <DropdownItem key="delete" icon={<TrashIcon />} isDanger
                                          onClick={() => remove(full, isDir)}>{_("Delete")}</DropdownItem>,
                        ]} />
                    );

                    const label = entry.target !== undefined
                        ? `${name} → ${entry.target}`
                        : name;

                    return {
                        isDir,
                        sortValues: [
                            name.toLowerCase(),
                            isDir ? -1 : (entry.size ?? 0),
                            entry.mtime ?? 0,
                            entry.mode ?? 0,
                            formatOwner(entry),
                        ],
                        props: { key: full, className: file === full ? 'folders-selected' : undefined },
                        columns: [
                            {
                                title: (
                                    <Button variant="link" isInline onClick={open}
                                            icon={isDir ? <FolderIcon /> : <FileIcon />}>
                                        {label}
                                    </Button>
                                ),
                                sortKey: name.toLowerCase(),
                            },
                            formatSize(entry.type, entry.size),
                            formatMtime(entry.mtime),
                            formatMode(entry.mode),
                            formatOwner(entry),
                            { title: actions, props: { className: 'pf-v6-c-table__action' } },
                        ],
                    };
                });
    }, [listing.info, dir, file, filter, showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

    const sortMethod = (unsorted, direction, index) => {
        const factor = direction === 'asc' ? 1 : -1;
        return [...unsorted].sort((a, b) => {
            // Folders stay grouped above files whichever way we sort.
            if (a.isDir !== b.isDir)
                return a.isDir ? -1 : 1;
            const av = a.sortValues?.[index];
            const bv = b.sortValues?.[index];
            if (typeof av === 'number' && typeof bv === 'number')
                return (av - bv) * factor;
            return String(av).localeCompare(String(bv)) * factor;
        });
    };

    if (!user)
        return <EmptyStatePanel loading />;

    /* Viewing a file takes over the whole page: the folder listing would only
     * be a distraction while reading or editing content. */
    if (file) {
        return (
            <>
                <PageSection hasBodyWrapper={false} padding={{ default: 'padding' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                        <FlexItem>
                            <Button variant="secondary" icon={<ArrowLeftIcon />}
                                    onClick={() => navigate({ path: dir })}>
                                {cockpit.format(_("Back to $0"), basename(dir) || '/')}
                            </Button>
                        </FlexItem>
                        <FlexItem flex={{ default: 'flex_1' }}>
                            <Breadcrumb>
                                {pathSegments(dir).map(seg => (
                                    <BreadcrumbItem key={seg.path} component="button"
                                                    onClick={() => navigate({ path: seg.path })}>
                                        {seg.name}
                                    </BreadcrumbItem>
                                ))}
                                <BreadcrumbItem isActive>{basename(file)}</BreadcrumbItem>
                            </Breadcrumb>
                        </FlexItem>
                    </Flex>
                </PageSection>
                <PageSection hasBodyWrapper={false} isFilled padding={{ default: 'padding' }}>
                    <FilePreview filePath={file} isFocused />
                </PageSection>
            </>
        );
    }

    const hiddenCount = Object.keys(listing.info?.entries || {})
            .filter(n => n.startsWith('.') && n !== '.' && n !== '..').length;

    return (
        <>
            <PageSection hasBodyWrapper={false} padding={{ default: 'padding' }}>
                <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                        <FlexItem>
                            <Button variant="secondary" icon={<ArrowLeftIcon />}
                                    isDisabled={parent === null}
                                    onClick={() => navigate({ path: parent })}>
                                {_("Back")}
                            </Button>
                        </FlexItem>
                        <FlexItem flex={{ default: 'flex_1' }}>
                            <Breadcrumb>
                                {pathSegments(dir).map((seg, idx, all) => (
                                    idx === all.length - 1
                                        ? <BreadcrumbItem key={seg.path} isActive>{seg.name}</BreadcrumbItem>
                                        : (
                                            <BreadcrumbItem key={seg.path} component="button"
                                                            onClick={() => navigate({ path: seg.path })}>
                                                {seg.name}
                                            </BreadcrumbItem>
                                        )
                                ))}
                            </Breadcrumb>
                        </FlexItem>
                    </Flex>
                    <FlexItem>
                        <PathBar dir={dir} home={user.home || '/'} />
                    </FlexItem>
                </Flex>
            </PageSection>
            <PageSection hasBodyWrapper={false} padding={{ default: 'padding' }}>
                <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                    <FlexItem>
                        <Button variant="secondary" icon={<FolderPlusIcon />} onClick={newFolder}>
                            {_("New folder")}
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button variant="secondary" icon={<FileMedicalIcon />} onClick={newFile}>
                            {_("New file")}
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button variant="secondary" icon={<UploadIcon />}
                                onClick={() => Dialogs.show(<UploadDialog dir={dir} />)}>
                            {_("Upload")}
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button variant="secondary" icon={<TerminalIcon />} onClick={openTerminal}>
                            {_("Open in Terminal")}
                        </Button>
                    </FlexItem>
                    <FlexItem flex={{ default: 'flex_1' }}>
                        <TextInput id="folders-filter" aria-label={_("Filter by name")}
                                   value={filter} onChange={(_ev, v) => setFilter(v)}
                                   placeholder={_("Filter by name")} className="folders-filter" />
                    </FlexItem>
                    <FlexItem>
                        <Checkbox id="folders-show-hidden" isChecked={showHidden}
                                  onChange={(_ev, checked) => setShowHidden(checked)}
                                  label={hiddenCount
                                      ? cockpit.format(_("Show hidden files ($0)"), hiddenCount)
                                      : _("Show hidden files")} />
                    </FlexItem>
                </Flex>
            </PageSection>
            <PageSection hasBodyWrapper={false} isFilled padding={{ default: 'padding' }}>
                {listing.error &&
                    <Alert variant="danger" isInline
                           title={errorString(listing.error)}>
                        {!superuser.allowed &&
                            <Content component="p">
                                {_("Turning on administrative access may let you read this folder.")}
                            </Content>
                        }
                    </Alert>
                }
                <ListingTable
                    variant="compact"
                    columns={[
                        { title: _("Name"), sortable: true },
                        { title: _("Size"), sortable: true },
                        { title: _("Modified"), sortable: true },
                        { title: _("Permissions"), sortable: true },
                        { title: _("Owner"), sortable: true },
                        { title: '' },
                    ]}
                    rows={rows}
                    sortMethod={sortMethod}
                    loading={listing.loading ? _("Loading directory…") : undefined}
                    emptyCaption={filter ? _("No matching files.") : _("This folder is empty.")}
                    isEmptyStateInTable={!!filter}
                />
            </PageSection>
        </>
    );
}

const FoldersPage = () => (
    <WithDialogs>
        <Page className="pf-m-no-sidebar">
            <PageSection hasBodyWrapper={false} padding={{ default: 'padding' }}>
                <Flex alignItems={{ default: 'alignItemsCenter' }}
                      justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                    <FlexItem>
                        <Title headingLevel="h2" size={TitleSizes['3xl']}>{_("Folders")}</Title>
                    </FlexItem>
                    <FlexItem><SuperuserButton /></FlexItem>
                </Flex>
            </PageSection>
            <FoldersBody />
        </Page>
    </WithDialogs>
);

document.addEventListener('DOMContentLoaded', () => {
    cockpit.translate();
    createRoot(document.getElementById('app')).render(<FoldersPage />);
});
