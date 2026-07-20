import {
    headerLimitError,
    responseHeaderSize,
    type HTTPTransport,
    type HTTPTransportRequest,
    type HTTPTransportResponse,
} from './http';

export function createBrowserHTTPTransport(): HTTPTransport {
    let closed = false;

    return {
        async request(
            request: HTTPTransportRequest,
            signal: AbortSignal,
        ): Promise<HTTPTransportResponse> {
            if (closed) {
                throw new Error('HTTP transport is closed');
            }

            const target = new URL(request.url);
            if (target.origin !== globalThis.location.origin) {
                throw new Error('browser HTTP requests must be same-origin');
            }

            const headers = new Headers();
            for (const [name, values] of Object.entries(request.headers)) {
                for (const value of values) {
                    headers.append(name, value);
                }
            }

            const response = await fetch(target, {
                method: request.method,
                headers,
                body:
                    request.body.byteLength === 0
                        ? undefined
                        : copyArrayBuffer(request.body),
                signal,
                redirect: 'error',
                credentials: 'same-origin',
            });

            const responseHeaders = [...response.headers.entries()];
            if (
                responseHeaderSize(responseHeaders) >
                request.maxResponseHeaderSize
            ) {
                await response.body?.cancel();
                throw headerLimitError(request.maxResponseHeaderSize);
            }

            const body = await readBoundedBody(
                response.body,
                request.maxResponseSize,
            );

            return {
                statusCode: response.status,
                status: `${response.status} ${response.statusText}`.trim(),
                headers: collectHeaders(responseHeaders),
                body: body.bytes,
                bodySizeExceeded: body.exceeded,
                observedBodySize: body.observedSize,
            };
        },
        close(): void {
            closed = true;
        },
    };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

async function readBoundedBody(
    body: ReadableStream<Uint8Array> | null,
    limit: number,
): Promise<{ bytes: Uint8Array; exceeded: boolean; observedSize: number }> {
    if (body == null) {
        return { bytes: new Uint8Array(), exceeded: false, observedSize: 0 };
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            const remaining = limit + 1 - size;
            if (remaining > 0) {
                chunks.push(value.subarray(0, remaining));
            }
            size += value.byteLength;

            if (size > limit) {
                await reader.cancel();
                return {
                    bytes: concatenate(chunks, limit + 1),
                    exceeded: true,
                    observedSize: Math.min(size, limit + 1),
                };
            }
        }
    } finally {
        reader.releaseLock();
    }

    return {
        bytes: concatenate(chunks, size),
        exceeded: false,
        observedSize: size,
    };
}

function collectHeaders(
    entries: Iterable<readonly [string, string]>,
): Record<string, string[]> {
    const output: Record<string, string[]> = Object.create(null);

    for (const [name, value] of entries) {
        (output[name] ??= []).push(value);
    }

    return output;
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
