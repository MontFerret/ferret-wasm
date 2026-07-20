import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import {
    Agent as HTTPAgent,
    request as httpRequest,
    type ClientRequestArgs,
    type ClientRequest,
    type IncomingMessage,
    type RequestOptions,
} from 'node:http';
import {
    Agent as HTTPSAgent,
    request as httpsRequest,
    type RequestOptions as HTTPSRequestOptions,
} from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

import {
    headerLimitError,
    responseHeaderSize,
    type AddressValidator,
    type HTTPTransport,
    type HTTPTransportRequest,
    type HTTPTransportResponse,
} from './http';

export type LookupAll = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface ValidatedAddress {
    address: string;
    family: 4 | 6;
}

const defaultLookupAll: LookupAll = (hostname) =>
    dnsLookup(hostname, { all: true, verbatim: true });
const pinnedAddress = Symbol('ferret.pinnedAddress');
type PinnedLookup = LookupFunction & { [pinnedAddress]: string };

class PinnedHTTPAgent extends HTTPAgent {
    override getName(options: ClientRequestArgs = {}): string {
        return `${super.getName(options)}:${lookupAddress(options.lookup)}`;
    }
}

class PinnedHTTPSAgent extends HTTPSAgent {
    override getName(options: HTTPSRequestOptions = {}): string {
        return `${super.getName(options)}:${lookupAddress(options.lookup)}`;
    }
}

export async function resolveNodeAddress(
    hostname: string,
    validateAddress: AddressValidator,
    lookupAll: LookupAll = defaultLookupAll,
): Promise<ValidatedAddress> {
    const literal = stripIPv6Brackets(hostname);
    const literalFamily = isIP(literal);
    const addresses =
        literalFamily === 0
            ? await lookupAll(hostname)
            : [{ address: literal, family: literalFamily }];

    if (addresses.length === 0) {
        throw new Error(`DNS lookup returned no addresses for ${hostname}`);
    }

    for (const candidate of addresses) {
        const denied = validateAddress(candidate.address);
        if (denied !== undefined) {
            throw new Error(denied);
        }
    }

    const selected = addresses[0];
    if (selected == null || (selected.family !== 4 && selected.family !== 6)) {
        throw new Error(
            `DNS lookup returned an invalid address for ${hostname}`,
        );
    }

    return { address: selected.address, family: selected.family };
}

export function createPinnedLookup(selected: ValidatedAddress): LookupFunction {
    const lookup = ((_hostname, _options, callback): void => {
        callback(null, selected.address, selected.family);
    }) as PinnedLookup;
    lookup[pinnedAddress] = selected.address;
    return lookup;
}

export function createNodeHTTPTransport(
    lookupAll: LookupAll = defaultLookupAll,
): HTTPTransport {
    const httpAgent = new PinnedHTTPAgent({ keepAlive: true });
    const httpsAgent = new PinnedHTTPSAgent({ keepAlive: true });
    const active = new Set<ClientRequest>();
    let closed = false;

    return {
        async request(
            request: HTTPTransportRequest,
            signal: AbortSignal,
            validateAddress: AddressValidator,
        ): Promise<HTTPTransportResponse> {
            if (closed) {
                throw new Error('HTTP transport is closed');
            }

            const target = new URL(request.url);
            if (target.protocol !== 'http:' && target.protocol !== 'https:') {
                throw new Error(
                    `unsupported HTTP protocol: ${target.protocol}`,
                );
            }

            const selected = await resolveNodeAddress(
                target.hostname,
                validateAddress,
                lookupAll,
            );

            return performRequest(
                target,
                request,
                signal,
                selected,
                target.protocol === 'https:' ? httpsAgent : httpAgent,
                active,
            );
        },
        close(): void {
            if (closed) {
                return;
            }

            closed = true;
            for (const request of active) {
                request.destroy(new Error('HTTP transport is closed'));
            }
            active.clear();
            httpAgent.destroy();
            httpsAgent.destroy();
        },
    };
}

function performRequest(
    target: URL,
    input: HTTPTransportRequest,
    signal: AbortSignal,
    selected: ValidatedAddress,
    agent: HTTPAgent | HTTPSAgent,
    active: Set<ClientRequest>,
): Promise<HTTPTransportResponse> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (
            error: unknown,
            response?: HTTPTransportResponse,
        ): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (error != null) {
                reject(error);
            } else {
                resolve(response as HTTPTransportResponse);
            }
        };

        const options: RequestOptions = {
            method: input.method,
            headers: input.headers,
            agent,
            signal,
            lookup: createPinnedLookup(selected),
            maxHeaderSize: input.maxResponseHeaderSize,
        };
        const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = send(target, options, (response) => {
            readNodeResponse(
                response,
                input.maxResponseSize,
                input.maxResponseHeaderSize,
            )
                .then((result) => finish(null, result))
                .catch((error: unknown) => finish(error));
        });

        active.add(request);
        request.once('close', () => active.delete(request));
        request.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'HPE_HEADER_OVERFLOW') {
                finish(headerLimitError(input.maxResponseHeaderSize));
                return;
            }
            finish(error);
        });

        if (input.body.byteLength === 0) {
            request.end();
        } else {
            request.end(input.body);
        }
    });
}

async function readNodeResponse(
    response: IncomingMessage,
    bodyLimit: number,
    headerLimit: number,
): Promise<HTTPTransportResponse> {
    const rawHeaders: Array<readonly [string, string]> = [];
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
        rawHeaders.push([
            response.rawHeaders[index] ?? '',
            response.rawHeaders[index + 1] ?? '',
        ]);
    }

    if (responseHeaderSize(rawHeaders) > headerLimit) {
        response.destroy();
        throw headerLimitError(headerLimit);
    }

    const chunks: Uint8Array[] = [];
    let size = 0;

    for await (const rawChunk of response) {
        const chunk = rawChunk as Uint8Array;
        const remaining = bodyLimit + 1 - size;
        if (remaining > 0) {
            chunks.push(chunk.subarray(0, remaining));
        }
        size += chunk.byteLength;

        if (size > bodyLimit) {
            response.destroy();
            return {
                statusCode: response.statusCode ?? 0,
                status: statusLine(response),
                headers: collectRawHeaders(rawHeaders),
                body: concatenate(chunks, bodyLimit + 1),
                bodySizeExceeded: true,
                observedBodySize: Math.min(size, bodyLimit + 1),
            };
        }
    }

    return {
        statusCode: response.statusCode ?? 0,
        status: statusLine(response),
        headers: collectRawHeaders(rawHeaders),
        body: concatenate(chunks, size),
        observedBodySize: size,
    };
}

function collectRawHeaders(
    entries: Iterable<readonly [string, string]>,
): Record<string, string[]> {
    const output: Record<string, string[]> = Object.create(null);

    for (const [name, value] of entries) {
        (output[name] ??= []).push(value);
    }

    return output;
}

function statusLine(response: IncomingMessage): string {
    return `${response.statusCode ?? 0} ${response.statusMessage ?? ''}`.trim();
}

function concatenate(chunks: Uint8Array[], size: number): Uint8Array {
    const output = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
        const available = Math.min(chunk.byteLength, size - offset);
        output.set(chunk.subarray(0, available), offset);
        offset += available;
        if (offset === size) {
            break;
        }
    }

    return output;
}

function stripIPv6Brackets(hostname: string): string {
    return hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
}

function lookupAddress(lookup: LookupFunction | undefined): string {
    return (lookup as PinnedLookup | undefined)?.[pinnedAddress] ?? '';
}
